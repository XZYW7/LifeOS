/**
 * 画像层（memex：写端控制体积，读端全量注入）
 * ─ 条目记忆 + confirmCount + 版本提交 = 证据层（全量保留，可审计、可重建）
 * ─ profile = 摘要层：从证据层蒸馏的 ≤800 字中文 Markdown 画像，丢了可重建
 * ─ 写端（控制体积）：仅两处触发——Organizer 整理完成后未入画像记忆 ≥5 条时异步重写；
 *   Dream 每晚归纳末尾（当天有变化时）按同一阈值检查重写。失败一律保留旧画像。
 * ─ 读端（全量注入）：super-agent.ts buildContextBlock 把 profile.content 全量放进上下文，
 *   另附「未入画像的新记忆」buffer（lastConfirmedAt 晚于 profile.updatedAt 的活跃记忆，≤10 条）。
 */
import type { LLMClient } from './llm.js';
import { loadState, saveState, type LifeOSState } from './store.js';
import type { MemoryEntry } from './types.js';
import { nowIso } from './util.js';

/** 未入画像的活跃记忆达到该条数即触发重写 */
export const PROFILE_REWRITE_THRESHOLD = 5;
/** 画像蒸馏的输入记忆上限（confirmCount 降序 + 近者优先） */
const PROFILE_SOURCE_LIMIT = 40;
/** 画像正文硬上限（字） */
const PROFILE_MAX_CHARS = 800;
/** 画像重写的 LLM 超时 */
const PROFILE_TIMEOUT_MS = 60_000;

const PROFILE_SECTIONS = ['# 核心身份', '# 价值观与偏好', '# 稳定模式', '# 当前关注'] as const;

// ── 选择器 ──────────────────────────────────

/** 画像蒸馏输入：全部活跃记忆按 confirmCount 降序、lastConfirmedAt 近者优先，截 40 条 */
export function selectProfileSourceMemories(state: LifeOSState): MemoryEntry[] {
  return state.memories
    .filter((m) => m.active && !m.superseded)
    .sort((a, b) =>
      (b.confirmCount ?? 1) - (a.confirmCount ?? 1)
      || b.lastConfirmedAt.localeCompare(a.lastConfirmedAt))
    .slice(0, PROFILE_SOURCE_LIMIT);
}

/**
 * 未入画像的新记忆（读端 buffer + 触发计数共用）：
 * 活跃且 lastConfirmedAt 晚于 profile.updatedAt。无画像时全部活跃记忆都算「未入画像」。
 * 两侧统一按日期比较（lastConfirmedAt 本身就是日期串），同日重写的记忆视为已入画像。
 */
export function unsyncedProfileMemories(state: LifeOSState): MemoryEntry[] {
  const profileDate = (state.profile?.updatedAt ?? '').slice(0, 10);
  return state.memories
    .filter((m) => m.active && !m.superseded && m.lastConfirmedAt.slice(0, 10) > profileDate)
    .sort((a, b) => b.lastConfirmedAt.localeCompare(a.lastConfirmedAt));
}

// ── Prompt ──────────────────────────────────

function buildPrompt(mems: MemoryEntry[], oldContent: string): string {
  const memList = mems
    .map((m) => `- (${m.kind}) ${m.content.replace(/\n+/g, ' ').slice(0, 120)}`)
    .join('\n');

  return `你是 LifeOS 的画像蒸馏器。下面是一个用户的长期记忆条目（证据层）和一份旧画像。请把证据层蒸馏成一份新的用户画像。

【记忆条目】（按确认次数降序，靠前的是被反复确认的稳定事实）
${memList}

【旧画像】（供参考与增量更新；可以为空）
${oldContent || '（尚无画像）'}

蒸馏规则（必须全部遵守）：
1. 事件转属性：不要记"买了 X""去了 Y"这类事件，要写它暗示的稳定属性——"重视 X 的人""有 Y 习惯"。
2. 矛盾时新值覆盖旧值：记忆与旧画像冲突、或记忆之间冲突时，以更近确认的为准，旧的直接删掉，不要罗列演变史。
3. 剪枝：确认次数低且久未再确认的次要细节，直接剪掉，不要舍不得。
4. 不写时间戳流水：画像里不出现"某月某日做了什么"，只保留稳定的身份、偏好、模式与当下关注。
5. 第三人称客观陈述：像一份冷静的用户档案，不抒情、不喊话、不用"你"。

输出要求：
- 中文 Markdown，正文总长度 ≤${PROFILE_MAX_CHARS} 字（含标题）。
- 固定且仅有以下四节，顺序与标题一字不差：
# 核心身份
# 价值观与偏好
# 稳定模式
# 当前关注
- 每节 2-5 条短句（用 - 列表），没有内容的节写"（暂无足够证据）"。
- 只输出画像正文本身，不要任何解释、前言或代码块标记。`;
}

// ── 重写 ──────────────────────────────────

/** 校验并修剪 LLM 输出：四节齐全；超长则在行边界截断到上限 */
function sanitizeProfile(raw: string): string | null {
  let text = raw.trim();
  // 容错：LLM 偶发用代码块包裹
  const fence = text.match(/^```(?:markdown)?\s*\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();
  for (const s of PROFILE_SECTIONS) {
    if (!text.includes(s)) return null;
  }
  if (text.length > PROFILE_MAX_CHARS) {
    // 行边界截断，保四节结构完整（截断只影响末节尾部）
    const cut = text.slice(0, PROFILE_MAX_CHARS);
    const lastNl = cut.lastIndexOf('\n');
    text = (lastNl > PROFILE_MAX_CHARS * 0.6 ? cut.slice(0, lastNl) : cut).trimEnd();
  }
  return text;
}

/**
 * 用证据层全量重写画像并落库。
 * 失败（LLM 异常 / 输出结构不合法 / 无输入记忆）一律返回 false，保留旧画像。
 */
export async function rewriteProfile(llm: LLMClient, state: LifeOSState): Promise<boolean> {
  if (!llm.configured) return false;
  const mems = selectProfileSourceMemories(state);
  if (mems.length === 0) return false;

  let text: string;
  try {
    const raw = await llm.chat(
      [
        { role: 'system', content: '你是 LifeOS 画像蒸馏器，只输出画像正文。' },
        { role: 'user', content: buildPrompt(mems, state.profile?.content ?? '') },
      ],
      { temperature: 0.3, maxTokens: 1500, timeoutMs: PROFILE_TIMEOUT_MS, task: 'profile' },
    );
    const sanitized = sanitizeProfile(raw);
    if (!sanitized) {
      console.warn('[profile] LLM 输出缺少固定四节，保留旧画像');
      return false;
    }
    text = sanitized;
  } catch (e) {
    console.warn('[profile] 重写失败，保留旧画像:', (e as Error).message);
    return false;
  }

  state.profile = { content: text, updatedAt: nowIso() };
  await saveState(state);
  console.log(`[profile] 画像已重写（${text.length} 字，输入 ${mems.length} 条记忆）`);
  return true;
}

/**
 * 触发入口（fire-and-forget）：重新加载最新状态，未入画像记忆 ≥ 阈值才重写。
 * force 仅供手动/调试触发。绝不抛异常（调用方不 await）。
 */
export async function rewriteProfileIfDue(llm: LLMClient, opts: { force?: boolean } = {}): Promise<boolean> {
  try {
    const state = await loadState();
    const pending = unsyncedProfileMemories(state);
    if (!opts.force && pending.length < PROFILE_REWRITE_THRESHOLD) return false;
    return await rewriteProfile(llm, state);
  } catch (e) {
    console.warn('[profile] 触发检查异常:', (e as Error).message);
    return false;
  }
}
