/**
 * Dream 定期归纳作业 —— 移植 TraceBrain「每日 Dream」理念
 * ─ 职责划界（与 organizer.ts 互补）：
 *   Dream 只做【跨天模式抽象】——作息规律、情绪趋势、能量模式等 ≥3 天数据支撑的规律；
 *   单日事实、待办任务、碎片整理是 Organizer（对话→数据异步整理）的地盘，这里一律不写。
 * ─ LLM 定期通读一天的碎片与状态，生成跨记录归纳（memex「跨记录洞察」的平替）
 * ─ 归纳面向人生模型：主题 / 线程进展 / 消耗源 / 给明天的建议
 * ─ 输入聚合：当日 captures jsonl + 当日 DailyState + 近 7 天状态 + 活跃线程标题 + 近期新增记忆
 * ─ 产出：data/dreams/YYYY-MM-DD.json（同日重跑覆盖）
 * ─ 副作用：1-2 条最有价值的跨天模式洞察写为 MemoryEntry(kind='insight', confidence='medium',
 *   sourceRefs 含 `dream:<date>`)，与现有活跃记忆做相似度去重
 * ─ 当日无 captures 且无 DailyState：返回 null（不烧 LLM）
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadState, saveState, writeMemoryMd, type LifeOSState } from './store.js';
import { listCaptures, type RawCapture } from './capture.js';
import { rewriteProfileIfDue } from './profile.js';
import type { LLMClient } from './llm.js';
import type { DailyState, MemoryEntry } from './types.js';
import { nowIso, todayStr, uid } from './util.js';

const DREAMS_DIR = path.join(DATA_DIR, 'dreams');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** LLM 熔断：8s */
const DREAM_TIMEOUT_MS = 60_000;
/** 相似度去重阈值（字符 bigram Jaccard） */
const DEDUP_THRESHOLD = 0.5;

// ── 类型 ──────────────────────────────────

export interface DreamGoalProgress {
  /** 线程标题（来自活跃线程，或 LLM 自行概括）。字段名沿用 goalProgress，语义为「线程进展」 */
  goal: string;
  /** 推进依据（引用当日记录） */
  evidence: string;
}

export interface DreamReport {
  date: string;
  /** 一段中文归纳 */
  summary: string;
  /** 今日主题 */
  themes: string[];
  /** 哪些线程有推进及依据（字段名沿用 goalProgress，语义为线程进展） */
  goalProgress: DreamGoalProgress[];
  /** 什么在消耗用户 */
  drainers: string[];
  /** 给明天的一句建议（克制不鸡血） */
  suggestion: string;
  generatedAt: string;
}

/** LLM 原始输出形状（含仅用于写记忆的 insights，不落 DreamReport） */
interface DreamLLMOutput {
  summary?: unknown;
  themes?: unknown;
  goalProgress?: unknown;
  drainers?: unknown;
  suggestion?: unknown;
  insights?: unknown;
}

// ── 文件存取 ──────────────────────────────────

function dreamFile(date: string): string {
  return path.join(DREAMS_DIR, `${date}.json`);
}

export async function dreamExists(date: string): Promise<boolean> {
  try {
    await fs.access(dreamFile(date));
    return true;
  } catch {
    return false;
  }
}

async function readDream(date: string): Promise<DreamReport | null> {
  try {
    const raw = await fs.readFile(dreamFile(date), 'utf-8');
    const parsed = JSON.parse(raw) as DreamReport;
    if (!parsed || typeof parsed.summary !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 最近的 DreamReport（按日期文件名倒序），无则 null */
export async function getLatestDream(): Promise<DreamReport | null> {
  let files: string[];
  try {
    files = await fs.readdir(DREAMS_DIR);
  } catch {
    return null;
  }
  const dates = files
    .map((f) => f.replace(/\.json$/, ''))
    .filter((d) => DATE_RE.test(d))
    .sort()
    .reverse();
  for (const d of dates) {
    const report = await readDream(d);
    if (report) return report;
  }
  return null;
}

// ── 输出消毒 ──────────────────────────────────

function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = clampStr(item, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function progressList(v: unknown): DreamGoalProgress[] {
  if (!Array.isArray(v)) return [];
  const out: DreamGoalProgress[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const goal = clampStr(o.goal, 80);
    const evidence = clampStr(o.evidence, 200);
    if (goal) out.push({ goal, evidence });
    if (out.length >= 5) break;
  }
  return out;
}

// ── 记忆去重（字符 bigram Jaccard 相似度） ──────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  if (s.length === 1) set.add(s);
  return set;
}

function similar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const sa = bigrams(na);
  const sb = bigrams(nb);
  if (sa.size === 0 || sb.size === 0) return false;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return inter / (sa.size + sb.size - inter) >= DEDUP_THRESHOLD;
}

// ── 输入聚合 ──────────────────────────────────

function formatDailyState(ds: DailyState | undefined): string {
  if (!ds) return '（无）';
  const parts: string[] = [`能量=${ds.energy}`];
  const dim = (name: string, d: { tag: string; note?: string }) =>
    parts.push(`${name}: ${d.tag}${d.note ? `（${d.note}）` : ''}`);
  dim('身体', ds.body);
  dim('情绪', ds.emotion);
  dim('社交', ds.social);
  dim('创造', ds.creative);
  dim('学习', ds.learning);
  if (ds.sleepHours != null) parts.push(`睡眠 ${ds.sleepHours}h`);
  if (ds.note) parts.push(`备注: ${ds.note}`);
  return parts.join('；');
}

function prevDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DreamInput {
  captures: RawCapture[];
  dailyState?: DailyState;
  recentStates: DailyState[];
  activeThreads: string[];
  recentMemories: string[];
}

function gatherInput(state: LifeOSState, date: string, captures: RawCapture[]): DreamInput {
  const since = prevDate(date, 7);
  const recentStates = Object.values(state.dailyStates)
    .filter((ds) => ds.date <= date && ds.date >= since)
    .sort((a, b) => a.date.localeCompare(b.date));
  // 线程模型收敛：输入读活跃线程（替代 goals/visions）
  const activeThreads = state.threads
    .filter((t) => t.status === 'active')
    .map((t) => `[线程/${t.domain}] ${t.title}`);
  const recentMemories = state.memories
    .filter((m) => m.active && !m.superseded && m.firstSeenAt >= since)
    .slice(-15)
    .map((m) => m.content);
  return { captures, dailyState: state.dailyStates[date], recentStates, activeThreads, recentMemories };
}

// ── Prompt ──────────────────────────────────

function buildPrompt(input: DreamInput, date: string, userName: string): string {
  const capturesText = input.captures.length > 0
    ? input.captures.map((c) => `- [${c.ts.slice(11, 16)}] ${c.text}`).join('\n')
    : '（无）';
  const statesText = input.recentStates.length > 0
    ? input.recentStates.map((ds) => `- ${ds.date}: ${formatDailyState(ds)}`).join('\n')
    : '（无）';
  const threadsText = input.activeThreads.length > 0 ? input.activeThreads.join('\n') : '（无）';
  const memoriesText = input.recentMemories.length > 0
    ? input.recentMemories.map((m) => `- ${m}`).join('\n')
    : '（无）';

  return `你是 LifeOS 的「Dream」归纳引擎。用户 ${userName} 在记录自己的生活碎片。请通读 ${date} 一天的碎片记录与状态，做一次面向人生模型的跨记录归纳。

【当日碎片】
${capturesText}

【当日状态】
${formatDailyState(input.dailyState)}

【近 7 天状态】
${statesText}

【活跃线程】
${threadsText}

【近期新增记忆】
${memoriesText}

只输出一个 JSON object，不要输出任何其他文字。结构：
{
  "summary": "一段中文归纳（80-200字）：这一天整体上是什么质地，碎片之间有什么联系",
  "themes": ["今日主题，2-4条，每条≤15字"],
  "goalProgress": [{"goal": "线程标题", "evidence": "推进依据（引用当日记录）"}],
  "drainers": ["什么在消耗用户，0-3条；行为层面的消耗（如刷手机、熬夜、拖延）也要点出来"],
  "suggestion": "给明天的一句建议（克制、具体、不鸡血，≤40字）",
  "insights": ["0-2条跨天模式洞察：仅限 ≥3 天数据支撑的规律（作息、情绪趋势、能量模式等）"]
}

职责边界（必须遵守）：
- insights 只做跨天模式抽象：必须是近 7 天状态/记忆里反复出现、≥3 天支撑的规律（如"连续熬夜后第二天能量必低""周四固定加班后情绪低落"）
- 禁止写单日事实（"今天见了谁""今天做了什么"）、待办/任务类内容、一次性情绪——那些是对话整理（Organizer）的职责，一律不写
- 单条碎片复述不算洞察；没有合格的跨天规律就给空数组，宁缺毋滥

要求：
- 只基于上面的输入，不要编造记录里没有的事
- 若当日没有可关联的活跃线程，goalProgress 给空数组`;
}

// ── 主流程 ──────────────────────────────────

/**
 * 生成指定日期的 Dream 归纳。
 * 当日无 captures 且无 DailyState 时返回 null（不烧 LLM）。
 * LLM 未配置时抛错（调用方决定降级策略）。
 */
export async function runDream(llm: LLMClient, date?: string): Promise<DreamReport | null> {
  const target = date && DATE_RE.test(date) ? date : todayStr();
  const state = await loadState();
  const captures = await listCaptures(target);

  if (captures.length === 0 && !state.dailyStates[target]) {
    return null;
  }
  if (!llm.configured) {
    throw new Error('LLM not configured (LLM_API_KEY missing)，无法运行 Dream');
  }

  const input = gatherInput(state, target, captures);
  const raw = await llm.chatJSON<DreamLLMOutput>(
    [
      { role: 'system', content: '你是 LifeOS Dream 归纳引擎，只输出 JSON。' },
      { role: 'user', content: buildPrompt(input, target, state.user.name) },
    ],
    { json: true, timeoutMs: DREAM_TIMEOUT_MS, temperature: 0.4, maxTokens: 1200, task: 'dream' },
  );

  // 输出消毒
  const report: DreamReport = {
    date: target,
    summary: clampStr(raw?.summary, 500) || `（${target} 归纳生成失败，summary 为空）`,
    themes: strList(raw?.themes, 4, 30),
    goalProgress: progressList(raw?.goalProgress),
    drainers: strList(raw?.drainers, 3, 60),
    suggestion: clampStr(raw?.suggestion, 100),
    generatedAt: nowIso(),
  };

  // 持久化（同日重跑覆盖）
  await fs.mkdir(DREAMS_DIR, { recursive: true });
  await fs.writeFile(dreamFile(target), JSON.stringify(report, null, 2), 'utf-8');

  // 1-2 条跨记录洞察 → MemoryEntry（与现有记忆去重）
  const insights = strList(raw?.insights, 2, 200);
  const today = todayStr();
  let dirty = false;
  for (const content of insights) {
    if (state.memories.some((m) => m.active && !m.superseded && similar(m.content, content))) continue;
    const entry: MemoryEntry = {
      id: uid('mem'),
      userId: state.user.id,
      kind: 'insight',
      content,
      sourceRefs: [`dream:${target}`, ...captures.slice(0, 3).map((c) => c.id)],
      confidence: 'medium',
      superseded: false,
      active: true,
      firstSeenAt: today,
      lastConfirmedAt: today,
    };
    state.memories.push(entry);
    await writeMemoryMd(entry);
    dirty = true;
  }
  if (dirty) {
    await saveState(state);
    // 画像层写端触发：当天归纳有新洞察落库（当天有变化）→ 检查是否达到重写阈值，异步重写
    rewriteProfileIfDue(llm).catch(() => {});
  }

  return report;
}

// ── 调度 ──────────────────────────────────

function yesterdayStr(): string {
  return prevDate(todayStr(), 1);
}

async function checkAndRun(llm: LLMClient): Promise<void> {
  const now = new Date();
  if (now.getHours() < 4) return;
  const y = yesterdayStr();
  if (await dreamExists(y)) return;
  // 昨日有数据才跑（captures 或 DailyState）
  const [captures, state] = await Promise.all([listCaptures(y), loadState()]);
  if (captures.length === 0 && !state.dailyStates[y]) return;
  try {
    const report = await runDream(llm, y);
    console.log(`[dream] 自动生成 ${y} 归纳${report ? '' : '（跳过：无数据）'}`);
  } catch (e) {
    console.warn(`[dream] 自动生成 ${y} 归纳失败:`, (e as Error).message);
  }
}

/** 启动 Dream 调度：立即检查一次，之后每小时检查一次 */
export function startDreamScheduler(llm: LLMClient): NodeJS.Timeout {
  checkAndRun(llm).catch((e) => console.warn('[dream] 调度检查异常:', (e as Error).message));
  return setInterval(() => {
    checkAndRun(llm).catch((e) => console.warn('[dream] 调度检查异常:', (e as Error).message));
  }, 60 * 60 * 1000);
}
