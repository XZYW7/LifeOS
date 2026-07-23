/**
 * 线程（Thread）领域逻辑 —— LifeOS 收敛核心
 * ─ 上限规则：活跃线程软上限 5 条；消耗型领域（career/creation）各最多 2 条活跃
 * ─ derive：LLM 读 memories+tasks+chatMessages 聚类提议线程（不落库，前端勾选后再采纳）
 * ─ today-nudge：平铺全部活跃线程 + 一句提醒（按当日 DailyState 能量档定语气）
 *   结果按 (date+mode) 缓存 data/today-nudge-YYYY-MM-DD.json，同日同模式不重复调 LLM
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadState, saveState, type LifeOSState } from './store.js';
import { extractAndRepairJSON } from './json-utils.js';
import type { LLMClient } from './llm.js';
import type { EnergyLevel, Task, Thread, ThreadDomain, ThreadStatus } from './types.js';
import { nowIso, todayStr, uid } from './util.js';

// ── 上限规则 ──────────────────────────────────

export const ACTIVE_SOFT_LIMIT = 5;
export const CONSUMING_DOMAIN_LIMIT = 2;
export const CONSUMING_DOMAINS: ReadonlySet<ThreadDomain> = new Set(['career', 'creation']);

export const THREAD_DOMAINS: readonly ThreadDomain[] = ['career', 'creation', 'relationship', 'self'];
export const THREAD_STATUSES: readonly ThreadStatus[] = ['active', 'parked', 'done', 'dropped'];

export function isThreadDomain(v: unknown): v is ThreadDomain {
  return typeof v === 'string' && (THREAD_DOMAINS as string[]).includes(v);
}

export function isThreadStatus(v: unknown): v is ThreadStatus {
  return typeof v === 'string' && (THREAD_STATUSES as string[]).includes(v);
}

export function activeThreadsOf(state: LifeOSState): Thread[] {
  return state.threads.filter((t) => t.status === 'active');
}

/** 今日页/今日提醒使用：只保留今天有未完成待办的活跃线程。 */
export function todayThreadsOf(state: LifeOSState, date = todayStr()): Thread[] {
  const todayThreadIds = new Set(
    state.tasks
      .filter((task) => task.status === 'todo' && task.date === date && task.threadId)
      .map((task) => task.threadId as string),
  );
  return activeThreadsOf(state).filter((thread) => todayThreadIds.has(thread.id));
}

/**
 * 匹配 threadTitle 到真实活跃 Thread（标题精确匹配，其次互相包含匹配；
 * 匹配不上返回 undefined → 关联落空）。capture / chat / super-agent 共用。
 */
export function resolveThread(state: { threads: Thread[] }, title?: string): Thread | undefined {
  if (!title) return undefined;
  const actives = state.threads.filter((t) => t.status === 'active');
  return actives.find((t) => t.title === title)
    ?? actives.find((t) => t.title.includes(title) || title.includes(t.title));
}

export interface ActivationViolation {
  error: string;
  hint: string;
}

/**
 * 校验某线程若以 active 状态存在是否违反上限。
 * excludeId：PATCH 场景排除线程自身。
 */
export function activationViolation(
  threads: Thread[],
  candidate: { domain: ThreadDomain },
  excludeId?: string,
): ActivationViolation | null {
  const actives = threads.filter((t) => t.status === 'active' && t.id !== excludeId);
  if (actives.length >= ACTIVE_SOFT_LIMIT) {
    return { error: `活跃线程已达软上限 ${ACTIVE_SOFT_LIMIT} 条`, hint: '先挂起一条' };
  }
  if (CONSUMING_DOMAINS.has(candidate.domain)) {
    const sameDomain = actives.filter((t) => t.domain === candidate.domain).length;
    if (sameDomain >= CONSUMING_DOMAIN_LIMIT) {
      return {
        error: `消耗型领域 ${candidate.domain} 最多 ${CONSUMING_DOMAIN_LIMIT} 条活跃`,
        hint: '先挂起一条同领域线程',
      };
    }
  }
  return null;
}

// ── derive：LLM 聚类提议线程 ──────────────────────────────────

export interface ThreadProposal {
  title: string;
  domain: ThreadDomain;
  note: string;
  evidenceSummary: string;
  /** 从【任务】列表里原样引用的相关任务标题，采纳时用于回填 task.threadId */
  relatedTaskTitles: string[];
}

const DERIVE_TIMEOUT_MS = 60_000;

function buildDerivePrompt(state: LifeOSState): string {
  const memories = state.memories
    .filter((m) => m.active && !m.superseded)
    .slice(-40)
    .map((m) => `- ${m.content.replace(/\n+/g, ' ').slice(0, 120)}`);
  const tasks = state.tasks.slice(-20).map((t) => `- [${t.status}] ${t.title}`);
  const chats = state.chatMessages
    .filter((m) => m.role === 'user')
    .slice(-10)
    .map((m) => `- ${m.content.replace(/\n+/g, ' ').slice(0, 100)}`);

  return `你是 LifeOS 的线程整理引擎。「线程」是人生里正在进行的事（如"求职游戏引擎开发""调养睡眠""维护亲密关系"），是系统里唯一的核心概念。
请通读用户 ${state.user.name} 的以下记录，把散落的记忆/任务/对话聚类成 3-8 条线程提议。

【长期记忆】
${memories.length > 0 ? memories.join('\n') : '（无）'}

【任务】
${tasks.length > 0 ? tasks.join('\n') : '（无）'}

【近期对话（用户发言）】
${chats.length > 0 ? chats.join('\n') : '（无）'}

只输出一个 JSON object，不要输出任何其他文字、解释或代码块标记。结构：
{
  "proposals": [
    {"title": "线程名（≤15字，动宾或名词短语，如\\"求职：游戏引擎岗\\"）",
     "domain": "career|creation|relationship|self",
     "note": "一句话说明这条线程是什么（≤40字）",
     "evidenceSummary": "依据：引用上面记录里的具体内容（≤80字）",
     "relatedTaskTitles": ["从上面【任务】列表里原样引用与本线程相关的任务标题，没有就空数组"]}
  ]
}

domain 定义：
- career：求职、工作、职业发展（消耗型）
- creation：作品、项目、创作输出（消耗型）
- relationship：家人、朋友、伴侣、社交
- self：身体、睡眠、情绪、学习、生活秩序

要求：
- 只基于上面的记录归纳，不要编造记录里没有的事
- 同一主题的记录合并为一条线程，不要按单条记录各开一条
- 消耗型领域（career/creation）合计提议不超过 3 条
- 按记录里的证据密度排序，证据最多的排前面`;
}

function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function sanitizeProposals(raw: unknown): ThreadProposal[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).proposals)
      ? ((raw as Record<string, unknown>).proposals as unknown[])
      : [];
  const out: ThreadProposal[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = clampStr(rec.title, 30);
    if (!title) continue;
    out.push({
      title,
      domain: isThreadDomain(rec.domain) ? rec.domain : 'self',
      note: clampStr(rec.note, 80),
      evidenceSummary: clampStr(rec.evidenceSummary, 150),
      relatedTaskTitles: Array.isArray(rec.relatedTaskTitles)
        ? rec.relatedTaskTitles
            .filter((x): x is string => typeof x === 'string')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .slice(0, 10)
        : [],
    });
    if (out.length >= 8) break;
  }
  return out;
}

/** LLM 聚类提议线程列表。失败抛错由调用方处理；结果不落库。 */
export async function deriveThreads(llm: LLMClient, state: LifeOSState): Promise<ThreadProposal[]> {
  const text = await llm.chat(
    [
      { role: 'system', content: '你是 LifeOS 线程整理引擎，只输出 JSON。' },
      { role: 'user', content: buildDerivePrompt(state) },
    ],
    { json: true, timeoutMs: DERIVE_TIMEOUT_MS, temperature: 0.3, maxTokens: 2000, task: 'thread-derive' },
  );
  try {
    return sanitizeProposals(extractAndRepairJSON<unknown>(text));
  } catch (e) {
    console.warn('[threads/derive] LLM 输出无法解析为 JSON，原始输出前 300 字:', text.slice(0, 300));
    throw e;
  }
}

// ── 自动梳理：有数据但 0 活跃线程时，系统自愈（数据打通的关键接线） ──────────────────────────────────

/** 让今日提醒缓存失效（线程集合变化后必须调用，否则今天页会一直显示旧提醒） */
export async function invalidateTodayNudgeCache(date = todayStr()): Promise<void> {
  try {
    await fs.unlink(nudgeCachePath(date));
  } catch {
    /* 缓存不存在则忽略 */
  }
}

/** 任务标题 ↔ 提议的相关任务标题：先精确匹配，再互相包含（长度≥4 才允许包含匹配） */
function titlesMatch(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4) return x.includes(y) || y.includes(x);
  return false;
}

/**
 * 把提议直接采纳为活跃线程（遵守软上限/消耗型领域上限，超限的提议跳过），
 * 并按 relatedTaskTitles 把现有待办回填 threadId。就地修改 state，不落库。
 */
export function adoptProposals(state: LifeOSState, proposals: ThreadProposal[]): Thread[] {
  const created: Thread[] = [];
  for (const p of proposals) {
    if (activationViolation(state.threads, { domain: p.domain })) continue;
    const now = nowIso();
    const thread: Thread = {
      id: uid('thr'),
      userId: state.user.id,
      title: p.title,
      domain: p.domain,
      status: 'active',
      ...(p.note ? { note: p.note } : {}),
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
    };
    state.threads.push(thread);
    created.push(thread);
    // 回填任务关联：relatedTaskTitles 命中的任务挂到这条线程（含已完成，作为线程的历史轨迹）
    for (const task of state.tasks) {
      if (task.threadId) continue;
      if (p.relatedTaskTitles.some((t) => titlesMatch(t, task.title))) {
        task.threadId = thread.id;
      }
    }
  }
  return created;
}

/** LLM 连续失败时的兜底：按关键词把待办任务聚到领域，一个领域一条线程（保证系统永不空白） */
const DOMAIN_KEYWORDS: Record<ThreadDomain, string[]> = {
  career: ['求职', '简历', '面试', '笔试', '工作', '岗位', '职业', 'offer', '网易', '莉莉丝', '米哈游', '腾讯'],
  creation: ['项目', '作品', '开发', '代码', '论文', 'agent', '3d', '引擎', '渲染', 'graphics', '实现', '复现'],
  relationship: ['朋友', '家人', '关系', '社交', '柠檬', '对象', '妈', '爸'],
  self: ['睡眠', '运动', '健身', '情绪', '休息', '电影', '吃饭', '身体', '学习', '恢复', '状态'],
};

function fallbackProposals(state: LifeOSState): ThreadProposal[] {
  const byDomain = new Map<ThreadDomain, Task[]>();
  for (const task of state.tasks) {
    if (task.status !== 'todo') continue;
    const text = task.title.toLowerCase();
    let best: ThreadDomain = 'self';
    let bestScore = 0;
    for (const domain of THREAD_DOMAINS) {
      const score = DOMAIN_KEYWORDS[domain].reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = domain;
      }
    }
    const list = byDomain.get(best) ?? [];
    list.push(task);
    byDomain.set(best, list);
  }
  const out: ThreadProposal[] = [];
  for (const [domain, tasks] of byDomain) {
    out.push({
      title: tasks[0].title.trim().slice(0, 15),
      domain,
      note: '系统根据现有任务自动归纳，可在对话里让 AI 细化',
      evidenceSummary: `关联 ${tasks.length} 个待办任务`,
      relatedTaskTitles: tasks.map((t) => t.title),
    });
  }
  return out;
}

export interface AutoDeriveResult {
  created: number;
  source: 'llm' | 'fallback' | 'skip';
}

/**
 * 自愈入口：有记忆/任务但 0 活跃线程时，自动提炼并直接采纳线程。
 * 永不抛错（任何失败都降级或 skip），可在导入后、today-nudge 前安全调用。
 */
export async function autoDeriveThreadsIfEmpty(llm: LLMClient): Promise<AutoDeriveResult> {
  try {
    const state = await loadState();
    if (activeThreadsOf(state).length > 0) return { created: 0, source: 'skip' };
    const hasData =
      state.memories.some((m) => m.active && !m.superseded) ||
      state.tasks.some((t) => t.status === 'todo') ||
      state.knowledge.length > 0;
    if (!hasData) return { created: 0, source: 'skip' };

    let proposals: ThreadProposal[] = [];
    let source: AutoDeriveResult['source'] = 'llm';
    if (llm.configured) {
      for (let attempt = 1; attempt <= 2 && proposals.length === 0; attempt++) {
        try {
          proposals = await deriveThreads(llm, state);
        } catch (e) {
          console.warn(`[threads/auto-derive] LLM 第 ${attempt} 次尝试失败:`, (e as Error).message);
        }
      }
    }
    if (proposals.length === 0) {
      proposals = fallbackProposals(state);
      source = 'fallback';
    }

    const created = adoptProposals(state, proposals);
    if (created.length === 0) return { created: 0, source: 'skip' };
    await saveState(state);
    await invalidateTodayNudgeCache();
    console.log(`[threads/auto-derive] 已自动采纳 ${created.length} 条线程（${source}）: ${created.map((t) => t.title).join(' / ')}`);
    return { created: created.length, source };
  } catch (e) {
    console.warn('[threads/auto-derive] 自愈失败（静默）:', (e as Error).message);
    return { created: 0, source: 'skip' };
  }
}

// ── today-nudge：今日一句提醒 ──────────────────────────────────

/** GET /api/today-nudge 的返回形状 */
export interface TodayNudge {
  date: string;
  text: string;
}

interface NudgeCache extends TodayNudge {
  mode: EnergyLevel;
  generatedAt: string;
}

const NUDGE_TIMEOUT_MS = 15_000;

function nudgeCachePath(date: string): string {
  return path.join(DATA_DIR, `today-nudge-${date}.json`);
}

/** 读当日提醒缓存；mode 不匹配（当天能量档变了）视为未命中 */
async function readNudgeCache(date: string, mode: EnergyLevel): Promise<TodayNudge | null> {
  try {
    const raw = await fs.readFile(nudgeCachePath(date), 'utf-8');
    const parsed = JSON.parse(raw) as NudgeCache;
    if (!parsed || parsed.date !== date || parsed.mode !== mode || typeof parsed.text !== 'string' || !parsed.text) {
      return null;
    }
    return { date: parsed.date, text: parsed.text };
  } catch {
    return null;
  }
}

/** 距今天数：lastTouchedAt 优先，其次 createdAt；都没有返回 null（视为从未照顾） */
function daysSince(t: Thread, date: string): number | null {
  const base = Date.parse(t.lastTouchedAt ?? '') || Date.parse(t.createdAt) || 0;
  if (!base) return null;
  const today = Date.parse(`${date}T00:00:00`);
  return Math.max(0, Math.floor((today - base) / 86_400_000));
}

function buildNudgePrompt(
  state: LifeOSState,
  mode: EnergyLevel,
  actives: Thread[],
  date: string,
): string {
  const modeText = { high: 'high（电量充足）', medium: 'medium（平衡）', low: 'low（省电/恢复日）' }[mode];
  const toneRule = {
    high: '可以积极一点，鼓励推进',
    medium: '轻推一下就好，不施压',
    low: '必须是允许型的语气，明确告诉用户"今天不碰也行"，不要安排任务',
  }[mode];
  const threadLines = actives.map((t) => {
    const todos = state.tasks.filter((x) => x.threadId === t.id && x.status === 'todo');
    const days = daysSince(t, date);
    const idle = days === null ? '从未照顾过' : days === 0 ? '今天刚照顾过' : `已经 ${days} 天没照顾`;
    return `- 线程「${t.title}」：${idle}，待办 ${todos.length} 项` +
      (todos.length > 0 ? `（${todos.slice(0, 3).map((x) => x.title).join('、')}）` : '');
  });

  return `你是 LifeOS 的今日提醒引擎。今天是 ${date}，用户 ${state.user.name} 当前能量档：${modeText}。
下面是用户全部活跃线程的真实状态：

${threadLines.join('\n')}

请写【一句话】今日提醒（≤40字）。

硬性要求：
- 只允许引用上面列出的真实线程标题和真实待办任务标题，禁止编造任何具体名词、事件、人名、公司名、App 名
- 语气规则：${toneRule}
- 不要鸡汤，不要口号，不要用感叹号
- 必须是完整的一句话，以句号结尾
- 只输出这一句话本身，不要引号、不要解释、不要任何其他文字`;
}

/** LLM 失败/未配置时的纯模板兜底：基于最久未照顾线程的真实标题 */
function fallbackNudge(mode: EnergyLevel, actives: Thread[], date: string): string {
  if (actives.length === 0) return '今天没有进行中的线程，随手记点什么就好';
  const sorted = [...actives].sort((a, b) => {
    const na = daysSince(a, date);
    const nb = daysSince(b, date);
    return (nb ?? Number.MAX_SAFE_INTEGER) - (na ?? Number.MAX_SAFE_INTEGER);
  });
  const t = sorted[0];
  const days = daysSince(t, date);
  // 最久未照顾的都是今天刚碰过 → 所有线程今天都照顾过了
  if (days === 0) {
    if (mode === 'low') return '几条线程今天都照顾过了，不碰也行';
    if (mode === 'high') return '几条线程今天都照顾过了，状态好就再推进一点';
    return '几条线程今天都照顾过了，剩下的时间随便安排';
  }
  const idle = days === null ? '一直没碰' : `${days} 天没碰了`;
  if (mode === 'low') return `「${t.title}」${idle}，但今天不碰也行`;
  if (mode === 'high') return `状态不错，「${t.title}」${idle}，今天可以推进一下`;
  return `「${t.title}」${idle}，今天给它十分钟就好`;
}

/** 清洗 LLM 输出：取首行、去引号、限长；为空、明显残句（助词结尾）或缺句末标点（大概率被截断）返回 null 走兜底 */
function sanitizeNudgeText(raw: string): string | null {
  const firstLine = raw.split('\n').map((s) => s.trim()).find((s) => s.length > 0) ?? '';
  const text = firstLine.replace(/^[「"'\s]+|[」"'\s]+$/g, '').trim().slice(0, 40);
  if (text.length < 8) return null;
  // 残句检测：以助词/连词/顿号结尾说明句子被截断或没说完
  if (/[的了和与及、，,；;：:]$/.test(text)) return null;
  // 完整句检测：没有句末标点多半是没说完的片段
  if (!/[。！？.!?]$/.test(text)) return null;
  return text;
}

/**
 * 计算今日一句提醒。按 (date+mode) 缓存到 data/today-nudge-YYYY-MM-DD.json，
 * 同日同模式直接返回缓存，不重复调 LLM；能量档变化当日重新生成。
 * LLM 失败/未配置时回退到纯模板话（基于最久未照顾线程的真实标题）。
 */
export async function computeTodayNudge(llm: LLMClient): Promise<TodayNudge> {
  const date = todayStr();
  const state = await loadState();
  const mode: EnergyLevel = state.dailyStates[date]?.energy ?? 'medium';

  const cached = await readNudgeCache(date, mode);
  if (cached) return cached;

  const actives = todayThreadsOf(state, date);
  let text: string | null = null;
  if (llm.configured && actives.length > 0) {
    // 最多 3 次尝试：模型偶尔返回空内容/残句，重试仍不合格则模板兜底
    for (let attempt = 1; attempt <= 3 && !text; attempt++) {
      try {
        const raw = await llm.chat(
          [
            { role: 'system', content: '你是 LifeOS 今日提醒引擎，只输出一句话。' },
            { role: 'user', content: buildNudgePrompt(state, mode, actives, date) },
          ],
          { timeoutMs: NUDGE_TIMEOUT_MS, temperature: 0.4, maxTokens: 120, task: 'today-nudge' },
        );
        text = sanitizeNudgeText(raw);
      } catch (e) {
        console.warn(`[today-nudge] LLM 第 ${attempt} 次生成失败:`, (e as Error).message);
      }
    }
  }
  if (!text) text = fallbackNudge(mode, actives, date);

  const result: NudgeCache = { date, mode, text, generatedAt: nowIso() };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(nudgeCachePath(date), JSON.stringify(result, null, 2), 'utf-8');
  return { date: result.date, text: result.text };
}
