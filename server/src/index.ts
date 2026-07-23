/**
 * LifeOS Server（P0 核心层）
 * ─ 严格实现 docs/api-contract.md 的全部端点
 * ─ Node 原生 http，无框架；tsx 直跑
 * ─ CORS：允许所有 localhost 来源
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentAction, ChatContext, ChatMessage, DailyState, Goal,
  LifeVersion, MemoryEntry, Task, Thread, ThreadStatus, User, Vision,
} from './types.js';
import {
  loadState, saveState, writeMemoryMd, packMemoriesIntoVersion, COST_LOG_PATH, DATA_DIR,
  type LifeOSState,
} from './store.js';
import { LLMClient, llmConfigFromEnv, CostTracker } from './llm.js';
import { SuperAgent, type ChatSnapshot } from './super-agent.js';
import { Organizer, undoOrganize } from './organizer.js';
import { ruleChat } from './agent-rules.js';
import { nowIso, todayStr, uid } from './util.js';
import { extractCapture, EMPTY_EXTRACTION, type CaptureExtraction } from './capture-extract.js';
import { persistRawCapture, listCaptures, applyExtraction, applyCaptureFallback } from './capture.js';
import { importMemex } from './import-memex.js';
import { runDream, getLatestDream, startDreamScheduler } from './dream.js';
import {
  activationViolation, autoDeriveThreadsIfEmpty, computeTodayNudge, deriveThreads,
  invalidateTodayNudgeCache, isThreadDomain, isThreadStatus,
} from './threads.js';

const PORT = Number(process.env.LIFEOS_PORT || 3456);
const VERSION = '0.1.0';

const llm = new LLMClient(llmConfigFromEnv());
llm.setCostTracker(new CostTracker(COST_LOG_PATH));
const superAgent = new SuperAgent(llm);
const organizer = new Organizer(llm);

/**
 * 整体替换状态时同步清空派生/缓存数据：
 * captures（原始碎片）、dreams（每日归纳）、today-nudge/today-focus 缓存、
 * memory md 镜像、memex 导入去重索引——它们全部派生自旧状态，留着会"还魂"。
 */
async function wipeDerivedData(): Promise<void> {
  const rmrf = (p: string) => fs.rm(p, { recursive: true, force: true }).catch(() => {});
  await rmrf(path.join(DATA_DIR, 'captures'));
  await rmrf(path.join(DATA_DIR, 'dreams'));
  await rmrf(path.join(DATA_DIR, 'memory'));
  await rmrf(path.join(DATA_DIR, 'memex-import-index.json'));
  const entries = await fs.readdir(DATA_DIR).catch(() => [] as string[]);
  for (const f of entries) {
    if ((f.startsWith('today-nudge-') || f.startsWith('today-focus-')) && f.endsWith('.json')) {
      await rmrf(path.join(DATA_DIR, f));
    }
  }
}

// ── HTTP 工具 ──────────────────────────────────

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
// Capacitor / Ionic WebView 常见 origin（手机端打包后请求本机后端时带这些来源）
const CAPACITOR_ORIGIN = /^(capacitor|ionic):\/\/localhost$/;

function setCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && (LOCALHOST_ORIGIN.test(origin) || CAPACITOR_ORIGIN.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    // 无 origin 的直连（curl、原生 WebView fetch、健康检查等）：放开读取
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ── 静态托管（app/dist，单端口 + SPA fallback）──

const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

const distExists = fsSync.existsSync(path.join(DIST_DIR, 'index.html'));
if (!distExists) {
  console.warn(`[static] 未找到前端构建产物 ${DIST_DIR}（先运行 cd app && npm run build），仅提供 /api/* 服务`);
}

/** 发送静态文件；成功返回 true */
async function sendFile(res: http.ServerResponse, filePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * GET 静态托管：先尝试 dist 内文件，未命中回退 index.html（React Router SPA fallback）。
 * /api/* 不走静态。dist 缺失时返回 false 交给 404。
 */
async function tryServeStatic(pathname: string, res: http.ServerResponse): Promise<boolean> {
  if (!distExists || pathname.startsWith('/api/')) return false;
  // 防目录穿越：解析后必须仍位于 DIST_DIR 内
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const resolved = path.resolve(DIST_DIR, rel);
  if (!resolved.startsWith(DIST_DIR + path.sep) && resolved !== DIST_DIR) return false;
  if (rel) {
    try {
      const st = await fs.stat(resolved);
      if (st.isFile()) return sendFile(res, resolved);
    } catch { /* 未命中 → 走 fallback */ }
  }
  return sendFile(res, path.join(DIST_DIR, 'index.html'));
}

/** 枚举本机局域网 IPv4 地址（非内部） */
function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) urls.push(`http://${info.address}:${port}`);
    }
  }
  return urls;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON');
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function requireObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '请求体必须是 JSON object');
  return body as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `缺少字段 ${key}`);
  return v.trim();
}

// ── Chat 编排 ──────────────────────────────────
// 两道工序：本函数是第一道（同步回复）；数据沉淀全部移交第二道 Organizer（异步，前端轮询）。

async function handleChat(body: unknown): Promise<{ payload: unknown; fallback: boolean }> {
  const input = requireString(requireObject(body), 'input');
  const state = await loadState();
  const userId = state.user.id;
  const now = nowIso();

  // 防双发：90 秒内完全相同内容的用户消息直接复用上一次的回复，不再调 LLM、不再启动整理
  const lastUserIdx = (() => { for (let i = state.chatMessages.length - 1; i >= 0; i--) { if (state.chatMessages[i].role === 'user') return i; } return -1; })();
  if (lastUserIdx >= 0) {
    const lastUser = state.chatMessages[lastUserIdx];
    const agentAfter = state.chatMessages.slice(lastUserIdx + 1).find((m) => m.role === 'agent');
    if (lastUser.content === input && agentAfter && Date.parse(now) - Date.parse(lastUser.createdAt) < 90_000) {
      const prevOrg = state.organizeResults.find((r) => r.messageId === lastUser.id);
      console.warn('[chat] 90s 内重复消息，复用上一条回复:', input.slice(0, 30));
      return {
        payload: { reply: agentAfter.content, actions: agentAfter.actions ?? [], organizeId: prevOrg?.id, agentMessageId: agentAfter.id, deduped: true },
        fallback: false,
      };
    }
  }

  // 持久化用户消息
  const userMsg: ChatMessage = { id: uid('msg'), userId, role: 'user', content: input, createdAt: now };
  state.chatMessages.push(userMsg);

  // 组装上下文（全量状态按日期升序；近 7 天；活跃记忆；近 7 天碎片；近 10 条对话）
  const states = Object.values(state.dailyStates).sort((a, b) => a.date.localeCompare(b.date));
  // 近 7 天碎片（对话与随手记同池），让复盘/回复不再只看打卡
  const recentCaptures: { date: string; text: string; source: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (const c of await listCaptures(dateStr)) {
      recentCaptures.push({ date: dateStr, text: c.text, source: c.source });
    }
  }
  const snapshot: ChatSnapshot = {
    user: state.user,
    visions: state.visions,
    goals: state.goals,
    tasks: state.tasks,
    threads: state.threads,
    states,
    recentStates: states.slice(-7),
    recentCaptures,
    memories: state.memories,
    knowledge: state.knowledge,
    profile: state.profile,
    chatMessages: state.chatMessages.slice(-10),
    lifeVersions: state.lifeVersions,
  };

  let reply: string;
  let actions: AgentAction[] = [];
  let recurringTasks: import('./super-agent.js').RecurringTaskIntent[] = [];
  let fallback = false;
  // 先生成整理任务 id，并写入 agent 消息，保证页面切换/刷新后仍能找到回执卡。
  const organizeId = uid('org');

  if (!llm.configured) {
    fallback = true;
    const ctx: ChatContext = { user: state.user, states, tasks: state.tasks, goals: state.goals, memories: state.memories, knowledge: state.knowledge };
    const r = ruleChat(input, ctx, userId);
    reply = r.reply;
    actions = r.actions ?? [];
    console.warn('[chat] LLM 未配置，走规则引擎 fallback');
  } else {
    try {
      const out = await superAgent.process(input, snapshot);
      reply = out.reply;
      actions = out.actions;
      recurringTasks = out.recurringTasks;
    } catch (e) {
      fallback = true;
      console.warn('[chat] LLM 调用失败，走规则引擎 fallback:', (e as Error).message);
      const ctx: ChatContext = { user: state.user, states, tasks: state.tasks, goals: state.goals, memories: state.memories, knowledge: state.knowledge };
      const r = ruleChat(input, ctx, userId);
      reply = r.reply;
      actions = r.actions ?? [];
    }
  }

  // 持久化 Agent 消息
  const agentMsg: ChatMessage = {
    id: uid('msg'), userId, role: 'agent', content: reply,
    actions: actions.length > 0 ? actions : undefined,
    organizeId,
    createdAt: nowIso(),
  };
  state.chatMessages.push(agentMsg);
  await saveState(state);

  // 第二道工序：Organizer 异步整理（不 await；结果落 state.organizeResults，前端轮询 GET /api/organize/:id）
  organizer.run({ messageId: userMsg.id, userMsg: input, agentReply: reply, snapshot, recurringTasks }, organizeId);

  return { payload: { reply, actions, organizeId, agentMessageId: agentMsg.id }, fallback };
}

// ── 路由 ──────────────────────────────────

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function route(method: string, pathPattern: string, handler: Handler): Route {
  const keys: string[] = [];
  const regex = new RegExp(
    '^' + pathPattern.replace(/:[^/]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    }) + '$',
  );
  return { method, pattern: regex, keys, handler };
}

const json = (res: http.ServerResponse, body: unknown = { ok: true }) => sendJson(res, 200, body);

/** upsert：按 id 替换或追加 */
function upsertById<T extends { id: string }>(arr: T[], item: T): void {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...item };
  else arr.push(item);
}

function patchById<T extends { id: string }>(arr: T[], id: string, patch: Partial<T>): T {
  const idx = arr.findIndex((x) => x.id === id);
  if (idx < 0) throw new HttpError(404, `未找到 id=${id}`);
  arr[idx] = { ...arr[idx], ...patch, id };
  return arr[idx];
}

const routes: Route[] = [
  // ── 健康与状态 ──
  route('GET', '/api/health', async (_req, res) => {
    json(res, { ok: true, llm: llm.configured, version: VERSION });
  }),

  // 手机/局域网访问提示：返回本机可用 LAN 地址
  route('GET', '/api/access-info', async (_req, res) => {
    json(res, { port: PORT, lanUrls: lanUrls(PORT) });
  }),

  route('GET', '/api/state', async (_req, res) => {
    json(res, await loadState());
  }),

  route('PUT', '/api/state', async (req, res) => {
    const body = requireObject(await readBody(req));
    const current = await loadState();
    // 整体替换（用于迁移/重置/恢复）；缺失字段保留当前值以防残缺 body 破坏状态
    const next = { ...current, ...body } as LifeOSState;
    if (!next.user || !Array.isArray(next.goals) || !Array.isArray(next.tasks) || !next.dailyStates) {
      throw new HttpError(400, '状态结构不合法');
    }
    // ── 类型守卫：客户端 bug 不得损坏核心结构 ──
    // dailyStates 必须是 { date: DailyState } 对象；曾出现客户端写入空数组导致
    // 打卡数据丢失 + isBlankData 误判为空白（触发迁移分支互相覆盖）。数组按 date 键归一化。
    if (Array.isArray(next.dailyStates)) {
      const arr = next.dailyStates as unknown as DailyState[];
      next.dailyStates = Object.fromEntries(
        arr.filter((x) => x && typeof x.date === 'string').map((x) => [x.date, x]),
      );
    } else if (typeof next.dailyStates !== 'object') {
      next.dailyStates = current.dailyStates;
    }
    // 列表字段：body 里给了但不是数组 → 保留服务端现值，拒绝损坏
    for (const key of ['threads', 'memories', 'tasks', 'knowledge', 'goals', 'visions', 'projects', 'chatMessages', 'lifeVersions', 'organizeResults'] as const) {
      const nextRec = next as unknown as Record<string, unknown>;
      if (key in body && !Array.isArray(nextRec[key])) {
        nextRec[key] = current[key];
      }
    }
    await saveState(next);
    await wipeDerivedData();
    json(res);
  }),

  // ── 细粒度写入（幂等 upsert）──
  route('POST', '/api/daily-states', async (req, res) => {
    const ds = requireObject(await readBody(req)) as unknown as DailyState;
    requireString(ds as unknown as Record<string, unknown>, 'date');
    if (!ds.id) ds.id = uid('ds');
    const state = await loadState();
    // 手动打卡：标 source:'manual'，Organizer 的自动 stateUpdates 绝不覆盖手动记录
    state.dailyStates[ds.date] = { ...state.dailyStates[ds.date], ...ds, source: 'manual' };
    await saveState(state);
    json(res);
  }),

  route('POST', '/api/tasks', async (req, res) => {
    const task = requireObject(await readBody(req)) as unknown as Task;
    if (!task.id) task.id = uid('task');
    const state = await loadState();
    upsertById(state.tasks, task);
    await saveState(state);
    json(res);
  }),

  route('PATCH', '/api/tasks/:id', async (req, res, params) => {
    const patch = requireObject(await readBody(req)) as Partial<Task>;
    const state = await loadState();
    patchById(state.tasks, params.id, patch);
    await saveState(state);
    json(res);
  }),

  route('POST', '/api/goals', async (req, res) => {
    const goal = requireObject(await readBody(req)) as unknown as Goal;
    if (!goal.id) goal.id = uid('goal');
    const state = await loadState();
    upsertById(state.goals, goal);
    await saveState(state);
    json(res);
  }),

  route('PATCH', '/api/goals/:id', async (req, res, params) => {
    const patch = requireObject(await readBody(req)) as Partial<Goal>;
    const state = await loadState();
    patchById(state.goals, params.id, patch);
    await saveState(state);
    json(res);
  }),

  route('POST', '/api/visions', async (req, res) => {
    const vision = requireObject(await readBody(req)) as unknown as Vision;
    if (!vision.id) vision.id = uid('vision');
    const state = await loadState();
    upsertById(state.visions, vision);
    await saveState(state);
    json(res);
  }),

  route('PATCH', '/api/visions/:id', async (req, res, params) => {
    const patch = requireObject(await readBody(req)) as Partial<Vision>;
    const state = await loadState();
    patchById(state.visions, params.id, patch);
    await saveState(state);
    json(res);
  }),

  route('POST', '/api/life-versions', async (req, res) => {
    const lv = requireObject(await readBody(req)) as unknown as LifeVersion;
    const state = await loadState();
    // 手动创建版本与 Organizer create_version 语义一致：新建即打包当前全部活跃记忆
    const isUpdate = typeof lv.id === 'string' && state.lifeVersions.some((x) => x.id === lv.id);
    if (!lv.id) lv.id = uid('lv');
    let packedCount: number | undefined;
    if (!isUpdate) {
      packedCount = packMemoriesIntoVersion(state, lv);
    }
    upsertById(state.lifeVersions, lv);
    await saveState(state);
    json(res, packedCount !== undefined ? { ok: true, packedMemories: packedCount } : undefined);
  }),

  route('POST', '/api/memories', async (req, res) => {
    const mem = requireObject(await readBody(req)) as unknown as MemoryEntry;
    if (!mem.id) mem.id = uid('mem');
    const state = await loadState();
    upsertById(state.memories, mem);
    await saveState(state);
    await writeMemoryMd(mem);
    json(res);
  }),

  route('PATCH', '/api/memories/:id', async (req, res, params) => {
    const patch = requireObject(await readBody(req)) as Partial<MemoryEntry>;
    const state = await loadState();
    const updated = patchById(state.memories, params.id, patch);
    await saveState(state);
    await writeMemoryMd(updated);
    json(res);
  }),

  route('POST', '/api/chat-messages', async (req, res) => {
    const msg = requireObject(await readBody(req)) as unknown as ChatMessage;
    if (!msg.id) msg.id = uid('msg');
    if (!msg.createdAt) msg.createdAt = nowIso();
    const state = await loadState();
    // 防重复：/api/chat 已权威落库 agent 回复；旧版前端会再 POST 一条同内容本地副本
    // （id 不同）。2 分钟内同内容 agent 消息视为重复，跳过。
    if (msg.role === 'agent') {
      const dup = state.chatMessages.some(
        (m) =>
          m.role === 'agent' &&
          m.content === msg.content &&
          Math.abs(Date.parse(m.createdAt) - Date.parse(msg.createdAt)) < 120_000,
      );
      if (dup) {
        json(res);
        return;
      }
    }
    upsertById(state.chatMessages, msg);
    await saveState(state);
    json(res);
  }),

  route('POST', '/api/energy-mode', async (req, res) => {
    const body = requireObject(await readBody(req));
    const level = body.level;
    if (level !== 'high' && level !== 'medium' && level !== 'low') {
      throw new HttpError(400, 'level 必须是 high|medium|low');
    }
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : '手动切换';
    const state = await loadState();
    const today = todayStr();
    const last = state.energyMode.history[state.energyMode.history.length - 1];
    if (last && !last.to) last.to = today;
    state.energyMode.history.push({ level, from: today, reason });
    state.energyMode.current = level;
    state.energyMode.effectiveFrom = today;
    state.energyMode.reason = reason;
    state.user.currentEnergyMode = level;
    await saveState(state);
    json(res);
  }),

  route('POST', '/api/users', async (req, res) => {
    const patch = requireObject(await readBody(req)) as Partial<User>;
    const state = await loadState();
    state.user = { ...state.user, ...patch, id: state.user.id };
    if (patch.settings) state.user.settings = { ...state.user.settings, ...patch.settings };
    await saveState(state);
    json(res);
  }),

  // ── AI 对话（核心）──
  route('POST', '/api/chat', async (req, res) => {
    const { payload, fallback } = await handleChat(await readBody(req));
    sendJson(res, 200, payload, fallback ? { 'x-lifeos-llm': 'fallback' } : { 'x-lifeos-llm': 'ok' });
  }),

  // ── Organizer 异步整理：轮询 + 撤销 ──
  route('GET', '/api/organize/:id', async (_req, res, params) => {
    const state = await loadState();
    const rec = state.organizeResults.find((r) => r.id === params.id);
    if (!rec) throw new HttpError(404, `未找到整理结果 id=${params.id}`);
    if (rec.status === 'done') {
      const { status, ...result } = rec;
      json(res, { status, result });
    } else {
      json(res, { status: rec.status });
    }
  }),

  route('POST', '/api/organize/:id/undo', async (_req, res, params) => {
    const outcome = await undoOrganize(params.id);
    if (!outcome) throw new HttpError(404, `未找到整理结果 id=${params.id}`);
    json(res, outcome);
  }),

  // ── 随手记碎片整理管线 ──
  route('POST', '/api/capture', async (req, res) => {
    const body = requireObject(await readBody(req));
    const text = requireString(body, 'text');
    const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'web';

    // 1. 原始碎片持久化（先于 LLM，保证不丢）
    const raw = await persistRawCapture(text, source);

    // 2. LLM 结构化抽取 → 3. 落实体；失败走降级
    const state = await loadState();
    let extraction: CaptureExtraction = EMPTY_EXTRACTION;
    let degraded = false;
    if (llm.configured) {
      try {
        const activeGoals = [
          ...state.visions.filter((v) => v.status === 'active').map((v) => ({ type: 'vision' as const, title: v.title })),
          ...state.goals.filter((g) => g.status === 'active').map((g) => ({ type: 'goal' as const, title: g.title })),
        ];
        const activeThreads = state.threads
          .filter((t) => t.status === 'active')
          .map((t) => ({ title: t.title, domain: t.domain }));
        extraction = await extractCapture(llm, text, { today: todayStr(), activeGoals, activeThreads });
      } catch (e) {
        degraded = true;
        console.warn('[capture] LLM 抽取失败，走降级路径:', (e as Error).message);
      }
    } else {
      degraded = true;
      console.warn('[capture] LLM 未配置，走降级路径');
    }

    if (degraded) await applyCaptureFallback(state, text, raw.id);
    else await applyExtraction(state, extraction, raw.id);
    await saveState(state);

    sendJson(res, 200, {
      captured: true,
      ...(degraded ? { degraded: true } : {}),
      echo: degraded
        ? { facts: [], insights: [], tasks: [], openLoops: [], stateSignals: [], knowledge: [] }
        : {
            facts: extraction.facts,
            insights: extraction.insights,
            tasks: extraction.tasks,
            openLoops: extraction.openLoops,
            stateSignals: extraction.stateSignals,
            knowledge: extraction.knowledge,
          },
    });
  }),

  route('GET', '/api/captures', async (req, res) => {
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams.get('date');
    const date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayStr();
    json(res, { date, captures: await listCaptures(date) });
  }),

  // ── Dream 定期归纳 ──
  route('POST', '/api/dream/run', async (req, res) => {
    const body = requireObject(await readBody(req));
    const date = body.date;
    if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
      throw new HttpError(400, 'date 必须是 YYYY-MM-DD');
    }
    try {
      const report = await runDream(llm, date as string | undefined);
      if (!report) json(res, { skipped: true });
      else json(res, report);
    } catch (e) {
      throw new HttpError(502, `Dream 归纳失败: ${(e as Error).message}`);
    }
  }),

  route('GET', '/api/dream/latest', async (_req, res) => {
    json(res, await getLatestDream());
  }),

  // ── 线程（Thread）：收敛核心，替代五层目标树 ──
  route('POST', '/api/threads', async (req, res) => {
    const body = requireObject(await readBody(req));
    const title = requireString(body, 'title');
    const domain = isThreadDomain(body.domain) ? body.domain : 'self';
    const status: ThreadStatus = isThreadStatus(body.status) ? body.status : 'active';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined;
    const sourceRefs = Array.isArray(body.sourceRefs)
      ? body.sourceRefs.filter((x): x is string => typeof x === 'string')
      : [];

    const state = await loadState();
    if (status === 'active') {
      const violation = activationViolation(state.threads, { domain });
      if (violation) {
        sendJson(res, 409, violation);
        return;
      }
    }
    const now = nowIso();
    const thread: Thread = {
      id: uid('thr'),
      userId: state.user.id,
      title,
      domain,
      status,
      ...(note ? { note } : {}),
      sourceRefs,
      createdAt: now,
      updatedAt: now,
    };
    state.threads.push(thread);
    await saveState(state);
    await invalidateTodayNudgeCache();
    sendJson(res, 201, thread);
  }),

  route('PATCH', '/api/threads/:id', async (req, res, params) => {
    const body = requireObject(await readBody(req));
    const state = await loadState();
    const idx = state.threads.findIndex((t) => t.id === params.id);
    if (idx < 0) throw new HttpError(404, `未找到线程 id=${params.id}`);
    const current = state.threads[idx];
    const next: Thread = { ...current, updatedAt: nowIso() };

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) throw new HttpError(400, 'title 必须是非空字符串');
      next.title = body.title.trim();
    }
    if (body.domain !== undefined) {
      if (!isThreadDomain(body.domain)) throw new HttpError(400, 'domain 必须是 career|creation|relationship|self');
      next.domain = body.domain;
    }
    if (body.status !== undefined) {
      if (!isThreadStatus(body.status)) throw new HttpError(400, 'status 必须是 active|parked|done|dropped');
      next.status = body.status;
    }
    if (body.note !== undefined) {
      if (typeof body.note === 'string' && body.note.trim()) next.note = body.note.trim();
      else delete next.note;
    }
    // 真实照顾标记（用户完成行动/对话关联时写入）；不算结构性变更
    if (body.lastTouchedAt !== undefined) {
      if (typeof body.lastTouchedAt !== 'string' || Number.isNaN(Date.parse(body.lastTouchedAt))) {
        throw new HttpError(400, 'lastTouchedAt 必须是 ISO 时间字符串');
      }
      next.lastTouchedAt = body.lastTouchedAt;
    }

    // 变更后若处于 active，重新校验软上限与消耗型领域上限（排除自身）
    if (next.status === 'active') {
      const violation = activationViolation(state.threads, next, current.id);
      if (violation) {
        sendJson(res, 409, violation);
        return;
      }
    }
    state.threads[idx] = next;
    await saveState(state);
    // 只有结构性变更（标题/领域/状态）才让今日提醒失效；
    // lastTouchedAt 变化影响的是「明天」的提醒，不应刷新今天已生成的提醒
    const structural = body.title !== undefined || body.domain !== undefined || body.status !== undefined;
    if (structural) await invalidateTodayNudgeCache();
    json(res, next);
  }),

  route('POST', '/api/threads/derive', async (_req, res) => {
    if (!llm.configured) throw new HttpError(503, 'LLM 未配置（LLM_API_KEY missing），无法生成线程提议');
    const state = await loadState();
    try {
      const proposals = await deriveThreads(llm, state);
      json(res, { proposals });
    } catch (e) {
      throw new HttpError(502, `线程提议生成失败: ${(e as Error).message}`);
    }
  }),

  route('GET', '/api/today-nudge', async (_req, res) => {
    // 自愈：有数据但 0 线程时先自动梳理，保证提醒有真实线程可引用
    await autoDeriveThreadsIfEmpty(llm);
    json(res, await computeTodayNudge(llm));
  }),

  // ── memex 备份一次性导入 ──
  route('POST', '/api/import/memex', async (req, res) => {
    const body = requireObject(await readBody(req));
    const zipPath = requireString(body, 'zipPath');
    try {
      const result = await importMemex(zipPath);
      // 数据打通：导入后若还没有活跃线程，自动从记忆/任务提炼（用户不该手动点"梳理"）
      const derived = await autoDeriveThreadsIfEmpty(llm);
      json(res, { ...result, threadsDerived: derived.created });
    } catch (e) {
      throw new HttpError(400, `memex 导入失败: ${(e as Error).message}`);
    }
  }),
];

// ── Server ──────────────────────────────────

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    try {
      await r.handler(req, res, params);
    } catch (e) {
      if (e instanceof HttpError) sendError(res, e.status, e.message);
      else {
        console.error(`[server] ${req.method} ${pathname} 未处理异常:`, (e as Error).message);
        sendError(res, 500, '服务器内部错误');
      }
    }
    return;
  }

  // 非 API 的 GET：静态文件 → SPA fallback(index.html)
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (await tryServeStatic(pathname, res)) return;
  }

  sendError(res, 404, `未找到路由 ${req.method} ${pathname}`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[lifeos-server] v${VERSION} listening on http://localhost:${PORT} (0.0.0.0)`);
  for (const u of lanUrls(PORT)) console.log(`[lifeos-server] LAN 访问: ${u}`);
  console.log(`[lifeos-server] 前端静态托管: ${distExists ? DIST_DIR : '未构建（仅 API）'}`);
  console.log(`[lifeos-server] LLM: ${llm.configured ? `configured (${process.env.LLM_PROVIDER || 'deepseek'} / ${llm.model})` : 'NOT configured, chat 将走规则引擎 fallback'}`);
  // Dream 调度：立即检查一次，之后每小时检查（本地 ≥04:00 且昨日归纳不存在且昨日有数据 → 自动 runDream(昨日)）
  startDreamScheduler(llm);
});
