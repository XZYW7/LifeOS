/**
 * Organizer —— 「对话→数据」异步整理管线（工具调用层）
 * ─ POST /api/chat 同步返回 reply 后不 await 启动；结果落 state.organizeResults 供前端轮询
 * ─ 架构：LLM 不再输出固定六个桶，而是输出 tool_calls: [{tool, args}]（一次 JSON 调用，≤6 个调用）。
 *   服务端按【工具注册表】逐个校验参数、执行、收集 Receipt 回执；
 *   未知工具 / 参数非法 / 单工具异常 → 跳过该条，不炸整批
 * ─ 职责边界：单日事实/任务/碎片/状态/版本沉淀全部在这里（回复通道不再沉淀）；
 *   跨天模式抽象（≥3天规律）是 dream.ts 的地盘，这里不写
 * ─ 失败安全：LLM 调用与变更执行分离——LLM 成功后才 loadState→逐个执行→saveState；
 *   LLM 失败只把记录标成 failed，不留脏数据
 * ─ 撤销：undoOrganize 按 receipts 逐个撤销未被用户动过的实体（见函数注释）
 */
import type { LLMClient } from './llm.js';
import {
  loadState, saveState, writeMemoryMd, deleteMemoryMd, packMemoriesIntoVersion, type LifeOSState,
} from './store.js';
import { persistRawCapture, deleteCaptures } from './capture.js';
import { activationViolation, isThreadDomain, resolveThread } from './threads.js';
import type {
  Confidence, DailyState, EnergyLevel, KnowledgeItem, LifeVersion, MemoryEntry, MemoryKind,
  OrganizeRecord, Receipt, Task, Thread, ThreadDomain,
} from './types.js';
import type { ChatSnapshot } from './super-agent.js';
import { rewriteProfileIfDue, unsyncedProfileMemories, PROFILE_REWRITE_THRESHOLD } from './profile.js';
import { nowIso, todayStr, uid } from './util.js';

const ORGANIZE_TIMEOUT_MS = 60_000;
/** state.organizeResults 保留上限（防 state.json 无限膨胀） */
const MAX_RECORDS = 100;
/** 一次整理允许的工具调用总量 */
const MAX_TOOL_CALLS = 6;
/** 同一工具在一次整理内的调用上限 */
const MAX_PER_TOOL = 2;
const MAX_NEW_MEMORIES = 2;
const MAX_TASKS = 3;
const MAX_NEW_THREADS = 1;

export interface OrganizerRunInput {
  /** 触发本轮整理的用户消息 id（OrganizeResult.messageId） */
  messageId: string;
  userMsg: string;
  agentReply: string;
  snapshot: ChatSnapshot;
}

// ── 通用消毒 ──────────────────────────────────

type OrganizeDimension = 'energy' | 'body' | 'emotion' | 'social' | 'creative' | 'learning';
const DIMENSIONS: readonly OrganizeDimension[] = ['energy', 'body', 'emotion', 'social', 'creative', 'learning'];

const DIMENSION_LABELS: Record<OrganizeDimension, string> = {
  energy: '能量', body: '身体', emotion: '情绪', social: '社交', creative: '创造', learning: '学习',
};

function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** energy 维度 value 归一化：接受 high|medium|low，容忍中文描述 */
function normalizeEnergy(v: string): EnergyLevel | null {
  const s = v.trim().toLowerCase();
  if (s === 'high' || s === 'medium' || s === 'low') return s;
  if (/(低|累|疲|差|没劲|透支)/.test(s)) return 'low';
  if (/(高|充沛|很好|不错)/.test(s)) return 'high';
  if (/(中|一般|还行)/.test(s)) return 'medium';
  return null;
}

/** 最长公共子串长度（用于 complete_task 零命中时找最接近的待办） */
function lcsLen(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Array<number>(n + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

// ── LLM 输出（tool_calls）消毒 ──────────────────────────────────

interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

function sanitizeToolCalls(raw: unknown): ToolCall[] {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(rec.tool_calls) ? rec.tool_calls : [];
  const out: ToolCall[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const tool = clampStr(c.tool, 30);
    if (!tool) continue;
    const args = (c.args && typeof c.args === 'object' && !Array.isArray(c.args))
      ? (c.args as Record<string, unknown>)
      : {};
    out.push({ tool, args });
    if (out.length >= MAX_TOOL_CALLS) break;
  }
  return out;
}

// ── 工具注册表 ──────────────────────────────────

/** 一次整理运行的上下文（跨工具共享的计数器与溯源 id） */
interface RunContext {
  messageId: string;
  userId: string;
  today: string;
  /** 各工具已成功执行次数（per-tool ≤2 上限） */
  perTool: Record<string, number>;
  newMemories: number;
  newTasks: number;
  newThreads: number;
}

interface ToolDef {
  name: string;
  /** 参数 JSON schema 描述（原样写进 prompt） */
  schema: string;
  run(state: LifeOSState, args: Record<string, unknown>, ctx: RunContext): Promise<Receipt>;
}

function skipped(tool: string, summary: string, skipReason: string, detail?: string): Receipt {
  return { tool, summary, kind: 'skipped', skipReason, ...(detail ? { detail } : {}) };
}

const TOOLS: Record<string, ToolDef> = {
  // ── 稳定事实/模式/洞察 → 长期记忆（matchMemoryId 或内容精确匹配 → 老记忆 confirmCount+1 刷日期）──
  record_memory: {
    name: 'record_memory',
    schema: `record_memory {"content": "≤200字", "kind": "fact|pattern|insight", "confidence": "low|medium|high", "matchMemoryId": "现有记忆id或null，可选", "threadTitle": "活跃线程标题，可选"} —— 用户透露稳定事实（习惯/固定安排/长期偏好/重要决定）时记录。写入纪律（必须遵守）：a) Default Deny：大多数输入是噪音，宁可不记也不要滥记；b) 7 天有效性测试：这条事实 7 天后对理解用户还有指导意义吗？没有就不要记；c) Profile vs Diary：不记事件流水（"今天跑了步"），只记它暗示的特质/模式（"有跑步习惯"，用 kind=pattern）；一次性事件/情绪应该用 record_fragment 而不是本工具。先判断与【现有活跃记忆】哪条是同一件事：同一件事 → matchMemoryId 填那条记忆的 id；全新信息 → 不填。`,
    async run(state, args, ctx) {
      const content = clampStr(args.content, 200);
      const kind = args.kind as MemoryKind;
      if (!content || !['fact', 'pattern', 'insight'].includes(kind)) {
        return skipped('record_memory', '记忆参数非法，已跳过', 'content 为空或 kind 非法');
      }
      const confidence: Confidence = (['low', 'medium', 'high'] as const).includes(args.confidence as Confidence)
        ? (args.confidence as Confidence)
        : 'medium';
      const matchMemoryId = clampStr(args.matchMemoryId, 60) || null;
      const threadTitle = clampStr(args.threadTitle, 60) || undefined;

      const actives = state.memories.filter((m) => m.active && !m.superseded);
      const matched = (matchMemoryId ? actives.find((m) => m.id === matchMemoryId) : undefined)
        ?? actives.find((m) => m.content === content);
      if (matched) {
        matched.confirmCount = (matched.confirmCount ?? 0) + 1;
        matched.lastConfirmedAt = ctx.today;
        return {
          tool: 'record_memory', kind: 'done', refId: matched.id,
          summary: `已确认记忆「${matched.content.slice(0, 30)}」（第 ${matched.confirmCount} 次确认）`,
          detail: 'confirmed',
        };
      }
      if (ctx.newMemories >= MAX_NEW_MEMORIES) {
        return skipped('record_memory', `新记忆超过单轮上限 ${MAX_NEW_MEMORIES} 条，已跳过`, '超过单轮新建上限');
      }
      const thread = resolveThread(state, threadTitle);
      const entry: MemoryEntry = {
        id: uid('mem'),
        userId: ctx.userId,
        kind,
        content,
        sourceRefs: [ctx.messageId, ...(thread ? [thread.id] : [])],
        confidence,
        superseded: false,
        active: true,
        firstSeenAt: ctx.today,
        lastConfirmedAt: ctx.today,
        confirmCount: 1,
      };
      state.memories.push(entry);
      await writeMemoryMd(entry);
      ctx.newMemories++;
      return {
        tool: 'record_memory', kind: 'done', refId: entry.id,
        summary: `已记下${{ fact: '事实', pattern: '模式', insight: '洞察' }[kind]}记忆「${content.slice(0, 30)}」`,
        detail: 'created',
      };
    },
  },

  // ── 闲聊碎事/一次性情绪 → 碎片池（与随手记同池，source:'chat'）──
  record_fragment: {
    name: 'record_fragment',
    schema: `record_fragment {"content": "≤100字，忠实原话"} —— 日常碎事、一次性情绪、不值得长期记住但值得留一笔的内容。`,
    async run(_state, args) {
      const content = clampStr(args.content, 100);
      if (!content) return skipped('record_fragment', '碎片内容为空，已跳过', 'content 为空');
      const raw = await persistRawCapture(content, 'chat');
      return {
        tool: 'record_fragment', kind: 'done', refId: raw.id,
        summary: `已记入碎片「${content.slice(0, 30)}」`,
      };
    },
  },

  // ── 可复用的知识沉淀（方法/经验/配方/攻略/资源/论文/学习收获）→ 知识库 ──
  record_knowledge: {
    name: 'record_knowledge',
    schema: `record_knowledge {"type": "note|method|experience|recipe|guide|resource|paper|idea|learning-log", "title": "≤40字", "content": "≤500字，可包含要点", "threadTitle": "相关活跃线程标题，可选"} —— 用户明确提到值得沉淀的【可复用内容】时调用：方法、经验、配方、攻略、工具与资源、学习笔记、论文、想法都算知识（不限学术）。与 record_memory 的边界：知识是【可复用的内容】（谁看都有用），记忆是【关于用户这个人的事实】；一次性感受/流水仍走 record_fragment。`,
    async run(state, args, ctx) {
      const type = args.type as KnowledgeItem['type'];
      if (!['note', 'method', 'experience', 'recipe', 'guide', 'resource', 'paper', 'idea', 'learning-log'].includes(type)) {
        return skipped('record_knowledge', `知识类型非法「${String(args.type)}」，已跳过`, 'type 非法');
      }
      const title = clampStr(args.title, 40);
      const content = clampStr(args.content, 500);
      if (!title || !content) {
        return skipped('record_knowledge', '知识标题或内容为空，已跳过', 'title/content 为空');
      }
      const threadTitle = clampStr(args.threadTitle, 60) || undefined;
      const thread = resolveThread(state, threadTitle);
      const item: KnowledgeItem = {
        id: uid('kn'),
        userId: ctx.userId,
        type,
        title,
        content,
        goalIds: [],
        projectIds: [],
        ...(thread ? { threadId: thread.id } : {}),
        createdAt: nowIso(),
      };
      state.knowledge.push(item);
      if (thread) {
        thread.lastTouchedAt = nowIso();
        thread.updatedAt = nowIso();
      }
      return {
        tool: 'record_knowledge', kind: 'done', refId: item.id,
        summary: `已记下知识《${title}》${thread ? ` → ${thread.title}` : ''}`,
      };
    },
  },

  // ── 用户明确说要去做的事 → 待办任务 ──
  add_task: {
    name: 'add_task',
    schema: `add_task {"title": "≤80字", "threadTitle": "活跃线程标题，可选"} —— 只提取【用户明确说了自己要去做】的事（"我要/我决定/记得要/下周得"）。AI 在回复里建议的事一律不要提取。`,
    async run(state, args, ctx) {
      const title = clampStr(args.title, 80);
      if (!title) return skipped('add_task', '任务标题为空，已跳过', 'title 为空');
      if (ctx.newTasks >= MAX_TASKS) {
        return skipped('add_task', `新任务超过单轮上限 ${MAX_TASKS} 条，已跳过`, '超过单轮新建上限');
      }
      const threadTitle = clampStr(args.threadTitle, 60) || undefined;
      const thread = resolveThread(state, threadTitle);
      const task: Task = {
        id: uid('task'),
        userId: ctx.userId,
        title,
        energyCost: 'medium',
        status: 'todo',
        date: ctx.today,
        ...(thread ? { threadId: thread.id } : {}),
      };
      state.tasks.push(task);
      ctx.newTasks++;
      return {
        tool: 'add_task', kind: 'done', refId: task.id,
        summary: `已添加待办「${title}」${thread ? ` → ${thread.title}` : ''}`,
      };
    },
  },

  // ── 用户明确说做完了某事 → 勾掉待办（标题模糊匹配，唯一命中才执行）──
  complete_task: {
    name: 'complete_task',
    schema: `complete_task {"taskTitle": "待办标题或其中的关键词"} —— 用户明确说做完了某事时调用。系统会在当前待办里按标题模糊匹配，唯一命中才勾掉。`,
    async run(state, args) {
      const q = clampStr(args.taskTitle, 80);
      if (!q) return skipped('complete_task', 'taskTitle 为空，已跳过', 'taskTitle 为空');
      const todos = state.tasks.filter((t) => t.status === 'todo');
      const hits = todos.filter((t) => t.title === q || t.title.includes(q) || q.includes(t.title));
      if (hits.length === 0) {
        const closest = [...todos]
          .map((t) => ({ t, score: lcsLen(q, t.title) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 2)
          .map((x) => x.t.title);
        return skipped(
          'complete_task',
          `没找到名为「${q}」的待办`,
          '零命中',
          closest.length > 0 ? `最接近的待办：${closest.map((s) => `「${s}」`).join('、')}` : undefined,
        );
      }
      if (hits.length > 1) {
        return skipped(
          'complete_task',
          `「${q}」命中了 ${hits.length} 个待办，无法确定是哪个`,
          '多个命中',
          hits.map((t) => `「${t.title}」`).join('、'),
        );
      }
      const task = hits[0];
      task.status = 'done';
      const thread = task.threadId ? state.threads.find((t) => t.id === task.threadId) : undefined;
      if (thread) {
        thread.lastTouchedAt = nowIso();
        thread.updatedAt = nowIso();
      }
      return {
        tool: 'complete_task', kind: 'done', refId: task.id,
        summary: `已勾掉待办「${task.title}」${thread ? ` → ${thread.title}` : ''}`,
      };
    },
  },

  // ── 用户改期/改名已有待办 → 更新任务（标题模糊匹配，唯一命中才执行）──
  update_task: {
    name: 'update_task',
    schema: `update_task {"taskTitle": "待办标题或关键词", "newDate": "新日期 YYYY-MM-DD（根据今天日期换算，如“改到周五”）", "newTitle": "新标题，可选"} —— 用户明确说某个待办改期/改时间/改内容时调用（如“笔试改到星期五”）。newDate 和 newTitle 至少给一个。`,
    async run(state, args) {
      const q = clampStr(args.taskTitle, 80);
      if (!q) return skipped('update_task', 'taskTitle 为空，已跳过', 'taskTitle 为空');
      const newDate = clampStr(args.newDate, 10);
      const newTitle = clampStr(args.newTitle, 60);
      if (newDate && !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        return skipped('update_task', `新日期格式非法「${newDate}」，已跳过`, 'newDate 非 YYYY-MM-DD');
      }
      if (!newDate && !newTitle) return skipped('update_task', '没有要改的内容，已跳过', 'newDate/newTitle 均为空');

      const todos = state.tasks.filter((t) => t.status === 'todo');
      const hits = todos.filter((t) => t.title === q || t.title.includes(q) || q.includes(t.title));
      if (hits.length === 0) {
        const closest = [...todos]
          .map((t) => ({ t, score: lcsLen(q, t.title) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 2)
          .map((x) => x.t.title);
        return skipped(
          'update_task',
          `没找到名为「${q}」的待办`,
          '零命中',
          closest.length > 0 ? `最接近的待办：${closest.map((s) => `「${s}」`).join('、')}` : undefined,
        );
      }
      if (hits.length > 1) {
        return skipped(
          'update_task',
          `「${q}」命中了 ${hits.length} 个待办，无法确定是哪个`,
          '多个命中',
          hits.map((t) => `「${t.title}」`).join('、'),
        );
      }
      const task = hits[0];
      const undoPayload: Record<string, string> = { date: task.date, title: task.title };
      const changes: string[] = [];
      if (newDate && newDate !== task.date) { task.date = newDate; changes.push(`改期到 ${newDate}`); }
      if (newTitle && newTitle !== task.title) { task.title = newTitle; changes.push(`改名为「${newTitle}」`); }
      if (changes.length === 0) return skipped('update_task', `待办「${task.title}」无需变更`, '新旧值相同');
      const thread = task.threadId ? state.threads.find((t) => t.id === task.threadId) : undefined;
      return {
        tool: 'update_task', kind: 'done', refId: task.id, undoPayload,
        summary: `已更新待办「${undoPayload.title}」：${changes.join('，')}${thread ? ` → ${thread.title}` : ''}`,
      };
    },
  },

  // ── 明确持续推进的新事项 → 自动建活跃线程（autoCreated，单轮 ≤1）──
  create_thread: {
    name: 'create_thread',
    schema: `create_thread {"title": "≤30字", "domain": "career|creation|relationship|self"} —— 用户明确说要【持续推进】的新事项（不是一次性任务）才调用，且不得与现有活跃线程同主题。`,
    async run(state, args, ctx) {
      const title = clampStr(args.title, 30);
      if (!title) return skipped('create_thread', '线程标题为空，已跳过', 'title 为空');
      const domain: ThreadDomain = isThreadDomain(args.domain) ? args.domain : 'self';
      if (ctx.newThreads >= MAX_NEW_THREADS) {
        return skipped('create_thread', `新线程超过单轮上限 ${MAX_NEW_THREADS} 条，已跳过`, '超过单轮新建上限');
      }
      const dup = resolveThread(state, title);
      if (dup) {
        return skipped('create_thread', `线程「${title}」与现有线程「${dup.title}」同主题，已跳过`, '重复线程');
      }
      const violation = activationViolation(state.threads, { domain });
      if (violation) {
        return {
          tool: 'create_thread', kind: 'suggestion',
          summary: `建议创建线程「${title}」`,
          detail: `${violation.error}，先作为建议保留`,
        };
      }
      const now = nowIso();
      const thread: Thread = {
        id: uid('thr'),
        userId: ctx.userId,
        title,
        domain,
        status: 'active',
        autoCreated: true,
        sourceRefs: [ctx.messageId],
        createdAt: now,
        updatedAt: now,
      };
      state.threads.push(thread);
      ctx.newThreads++;
      return {
        tool: 'create_thread', kind: 'done', refId: thread.id,
        summary: `已创建线程「${title}」（${domain}）`,
      };
    },
  },

  // ── 疑似新线程但不确定 → 建议（不落库，前端渲染 [创建] 按钮）──
  suggest_thread: {
    name: 'suggest_thread',
    schema: `suggest_thread {"title": "≤30字", "reason": "≤80字"} —— 疑似新线程但不确定时给建议，不落库，由用户确认。`,
    async run(_state, args) {
      const title = clampStr(args.title, 30);
      if (!title) return skipped('suggest_thread', '建议线程标题为空，已跳过', 'title 为空');
      const reason = clampStr(args.reason, 80) || '疑似新线程，待用户确认';
      return {
        tool: 'suggest_thread', kind: 'suggestion',
        summary: `建议创建线程「${title}」`,
        detail: reason,
      };
    },
  },

  // ── 用户明确说了当下状态 → 打卡（manual 不覆盖，source:'auto'）──
  fill_checkin: {
    name: 'fill_checkin',
    schema: `fill_checkin {"dimension": "energy|body|emotion|social|creative|learning", "value": "energy 维度为 high|medium|low，其余为≤30字描述", "tag": "≤8字定性标签"} —— 用户明确说了当下状态（累/睡得好/心情差等）时调用。`,
    async run(state, args, ctx) {
      const dimension = args.dimension as OrganizeDimension;
      if (!DIMENSIONS.includes(dimension)) {
        return skipped('fill_checkin', `打卡维度非法「${String(args.dimension)}」，已跳过`, 'dimension 非法');
      }
      const value = clampStr(args.value, 60);
      if (!value) return skipped('fill_checkin', '打卡内容为空，已跳过', 'value 为空');
      const tag = clampStr(args.tag, 12) || value.slice(0, 8);

      const existing = state.dailyStates[ctx.today];
      if (existing && (existing.source ?? 'manual') === 'manual') {
        return skipped('fill_checkin', '今日已有手动打卡，自动状态不覆盖', '手动打卡优先');
      }
      const base: DailyState = existing ?? {
        id: uid('ds'),
        userId: ctx.userId,
        date: ctx.today,
        energy: 'medium',
        body: { tag: '—' },
        emotion: { tag: '—' },
        social: { tag: '—' },
        creative: { tag: '—' },
        learning: { tag: '—' },
      };
      if (dimension === 'energy') {
        const level = normalizeEnergy(value);
        if (!level) return skipped('fill_checkin', `能量值无法归一化「${value}」，已跳过`, 'value 非法');
        base.energy = level;
      } else {
        base[dimension] = { tag, note: value };
      }
      base.source = 'auto';
      state.dailyStates[ctx.today] = base;
      return {
        tool: 'fill_checkin', kind: 'done',
        summary: `已记录今日${DIMENSION_LABELS[dimension]}状态：${tag}`,
      };
    },
  },

  // ── 用户明确说记版本/阶段结束/总结一下这段 → 创建人生版本 ──
  create_version: {
    name: 'create_version',
    schema: `create_version {"title": "版本名，形如「2026年7月·求职季」", "summary": "≤300字的版本小结，基于【版本上下文】里的真实数据起草", "gained": ["获得了什么（能力/作品/关系），可选"], "dropped": ["放弃了什么（目标/执念/身份），可选"]} —— 用户明确说记版本、阶段结束、总结一下这段时调用。`,
    async run(state, args, ctx) {
      const title = clampStr(args.title, 40);
      const summary = clampStr(args.summary, 300);
      if (!title || !summary) {
        return skipped('create_version', '版本标题或小结为空，已跳过', 'title/summary 为空');
      }
      const gained = Array.isArray(args.gained)
        ? args.gained.filter((x): x is string => typeof x === 'string').map((s) => s.trim().slice(0, 60)).filter(Boolean).slice(0, 8)
        : [];
      const dropped = Array.isArray(args.dropped)
        ? args.dropped.filter((x): x is string => typeof x === 'string').map((s) => s.trim().slice(0, 60)).filter(Boolean).slice(0, 8)
        : [];
      const version: LifeVersion = {
        id: uid('lv'),
        userId: ctx.userId,
        version: title,
        date: ctx.today,
        happened: [],
        gained,
        released: dropped,
        summary,
        createdAt: nowIso(),
      };
      state.lifeVersions.push(version);
      // git commit 语义：创建版本即把当前全部活跃记忆打包进该版本
      const packedCount = packMemoriesIntoVersion(state, version);
      return {
        tool: 'create_version', kind: 'done', refId: version.id,
        summary: `已创建版本《${title}》，打包 ${packedCount} 条记忆`,
      };
    },
  },

  // ── 用户明确说某线程暂停/恢复/完结 → 改线程状态 ──
  update_thread: {
    name: 'update_thread',
    schema: `update_thread {"threadTitle": "线程标题", "action": "pause|resume|finish"} —— 用户明确说某线程暂停/恢复/完结时调用。pause=挂起，resume=恢复活跃，finish=完结。`,
    async run(state, args) {
      const q = clampStr(args.threadTitle, 60);
      const action = args.action;
      if (!q || (action !== 'pause' && action !== 'resume' && action !== 'finish')) {
        return skipped('update_thread', 'update_thread 参数非法，已跳过', 'threadTitle 为空或 action 非法');
      }
      // resume 只从暂停线程里找；pause/finish 从活跃+暂停里找
      const pool = state.threads.filter((t) =>
        action === 'resume' ? t.status === 'parked' : (t.status === 'active' || t.status === 'parked'));
      const thread = pool.find((t) => t.title === q)
        ?? pool.find((t) => t.title.includes(q) || q.includes(t.title));
      const actionLabel = { pause: '暂停', resume: '恢复', finish: '完结' }[action];
      if (!thread) {
        return skipped(
          'update_thread',
          `没找到可${actionLabel}的线程「${q}」`,
          '零命中',
          pool.length > 0 ? `可选线程：${pool.slice(0, 3).map((t) => `「${t.title}」`).join('、')}` : undefined,
        );
      }
      if (action === 'resume') {
        const violation = activationViolation(state.threads, { domain: thread.domain }, thread.id);
        if (violation) {
          return skipped('update_thread', `无法恢复线程「${thread.title}」：${violation.error}`, violation.error);
        }
      }
      const nextStatus = { pause: 'parked', resume: 'active', finish: 'done' }[action] as Thread['status'];
      if (thread.status === nextStatus) {
        return skipped('update_thread', `线程「${thread.title}」已是目标状态，无需变更`, '状态未变化');
      }
      thread.status = nextStatus;
      thread.updatedAt = nowIso();
      let detail: string | undefined;
      if (action === 'finish') {
        const remaining = state.tasks.filter((t) => t.threadId === thread.id && t.status === 'todo').length;
        if (remaining > 0) detail = `该线程还有 ${remaining} 个待办任务未完成`;
      }
      return {
        tool: 'update_thread', kind: 'done', refId: thread.id,
        summary: `已${actionLabel}线程「${thread.title}」`,
        ...(detail ? { detail } : {}),
      };
    },
  },
};

// ── Prompt ──────────────────────────────────

function buildPrompt(input: OrganizerRunInput): string {
  const { userMsg, agentReply, snapshot } = input;
  const today = todayStr();

  const activeThreads = snapshot.threads.filter((t) => t.status === 'active');
  const threadList = activeThreads.length > 0
    ? activeThreads.map((t) => `- ${t.id} [${t.domain}] ${t.title}`).join('\n')
    : '（当前没有活跃线程）';

  const parkedThreads = snapshot.threads.filter((t) => t.status === 'parked');
  const parkedList = parkedThreads.length > 0
    ? parkedThreads.map((t) => `- ${t.id} [${t.domain}] ${t.title}`).join('\n')
    : '（当前没有暂停线程）';

  const todoTasks = snapshot.tasks.filter((t) => t.status === 'todo').slice(-20);
  const todoList = todoTasks.length > 0
    ? todoTasks.map((t) => {
        const th = t.threadId ? snapshot.threads.find((x) => x.id === t.threadId) : undefined;
        return `- ${t.title}${th ? `（线程：${th.title}）` : ''}`;
      }).join('\n')
    : '（当前没有待办任务）';

  const activeMems = snapshot.memories.filter((m) => m.active && !m.superseded).slice(-20);
  const memList = activeMems.length > 0
    ? activeMems.map((m) => `- ${m.id} (${m.kind}) ${m.content.replace(/\n+/g, ' ').slice(0, 80)}`).join('\n')
    : '（当前没有活跃记忆）';

  const ds = snapshot.states.find((s) => s.date === today);
  const checkin = ds
    ? `今日已打卡（source=${ds.source ?? 'manual'}）：能量=${ds.energy}；身体=${ds.body.tag}；情绪=${ds.emotion.tag}；社交=${ds.social.tag}；创造=${ds.creative.tag}；学习=${ds.learning.tag}${ds.note ? `；备注="${ds.note}"` : ''}`
    : '（今日尚未打卡）';

  // create_version 起草上下文：近 30 天记忆摘要 + 近期线程变化 + 上一个版本
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recentMems = activeMems.filter((m) => m.lastConfirmedAt >= cutoffStr).slice(-15);
  const recentMemList = recentMems.length > 0
    ? recentMems.map((m) => `- ${m.content.replace(/\n+/g, ' ').slice(0, 60)}`).join('\n')
    : '（近 30 天没有记忆）';
  const threadChanges = snapshot.threads.slice(-10).map((t) =>
    `- 「${t.title}」[${t.domain}] 状态=${t.status}，更新于 ${t.updatedAt.slice(0, 10)}`);
  const threadChangeList = threadChanges.length > 0 ? threadChanges.join('\n') : '（暂无线程）';
  const lastVersion = snapshot.lifeVersions[snapshot.lifeVersions.length - 1];
  const lastVersionText = lastVersion
    ? `《${lastVersion.version}》（发布于 ${lastVersion.date}）`
    : '（还没有任何版本记录）';

  return `你是 LifeOS 的整理引擎（Organizer）。用户刚和 AI 搭档完成一轮对话。你的唯一职责：把这轮对话里有沉淀价值的信息，通过调用下面的工具结构化落库。不要回复用户，只做数据整理。

今天是 ${today}。

【用户消息】
${userMsg}

【AI 回复】
${agentReply}

【活跃线程】（id [领域] 标题）
${threadList}

【暂停线程】（id [领域] 标题）
${parkedList}

【当前待办】
${todoList}

【现有活跃记忆】（id (类型) 内容）
${memList}

【今日打卡状态】
${checkin}

【版本上下文】（仅供 create_version 起草参考）
近 30 天记忆摘要：
${recentMemList}
近期线程变化：
${threadChangeList}
上一个版本：${lastVersionText}

【可用工具】
${Object.values(TOOLS).map((t) => `- ${t.schema}`).join('\n')}

【判断规则】（逐条对照用户消息检查，命中的规则【必须】生成对应工具调用，不允许忽略）
- 用户明确说做完了/搞定了/提交了某事，且【当前待办】里有相关条目 → 必须 complete_task
- 用户明确说某个待办改期/改时间/推迟/改内容（如“笔试改到星期五”）→ 必须 update_task（newDate 按今天日期换算成 YYYY-MM-DD）
- 用户明确说记版本 / 阶段结束 / 总结一下这段 → 必须 create_version（title 形如「2026年7月·求职季」，summary 基于【版本上下文】的真实数据起草，不要编造）
- 用户明确说某线程暂停 / 恢复 / 完结 → 必须 update_thread
- 用户明确说要去做某事 → add_task
- 用户明确说要持续推进新事项 → create_thread；疑似但不确定 → suggest_thread
- 用户明确说了当下状态 → fill_checkin
- 稳定事实/长期信息 → record_memory（先过写入纪律：Default Deny、7 天有效性测试；事件流水/一次性情绪 → record_fragment，不要用 record_memory）
- 用户明确提到值得沉淀的知识/方法/经验/配方/攻略/资源/论文/学习收获（如"这个方法不错记下来""我学到……"）→ 必须 record_knowledge（知识是【可复用的内容】，与【关于用户这个人的事实】的记忆、一次性感受的碎片三者别混）
- 闲聊碎事/一次性情绪 → record_fragment

通用规则：
- 每类工具最多 2 个调用，全部调用总量 ≤ 6。
- 线程标题只能从【活跃线程】/【暂停线程】里原样引用。
- 没有值得做的事就输出空调用列表。
- 忠实用户原话，不要编造，不要过度推断，不要复述 AI 的建议当成用户的事实。

只输出一个 JSON object，禁止输出任何其他文字、解释或代码块标记。
硬性格式要求：顶层必须有且只有一个 "tool_calls" 键，值是调用数组；每个元素形如 {"tool": "工具名", "args": {...}}。
即使只有一个调用也必须放进数组；没有值得做的事也必须输出 {"tool_calls": []}。禁止输出 {} 或其他任何键。
正确示例：{"tool_calls": [{"tool": "complete_task", "args": {"taskTitle": "莉莉丝笔试"}}]}`;
}

// ── 工具调用执行（逐个校验、执行、收集回执；单条失败不影响整批）──────────────────────────────────

async function runToolCalls(
  state: LifeOSState,
  calls: ToolCall[],
  messageId: string,
): Promise<Receipt[]> {
  const ctx: RunContext = {
    messageId,
    userId: state.user.id,
    today: todayStr(),
    perTool: {},
    newMemories: 0,
    newTasks: 0,
    newThreads: 0,
  };
  const receipts: Receipt[] = [];
  for (const call of calls) {
    const tool = TOOLS[call.tool];
    if (!tool) {
      receipts.push(skipped(call.tool, `未知工具「${call.tool}」，已跳过`, '未知工具'));
      continue;
    }
    // create_version 一轮只允许 1 次（同一阶段重复提交没有语义，LLM 偶发连发两次会造成重复版本）
    const toolLimit = call.tool === 'create_version' ? 1 : MAX_PER_TOOL;
    if ((ctx.perTool[call.tool] ?? 0) >= toolLimit) {
      receipts.push(skipped(call.tool, `工具 ${call.tool} 超过单次上限 ${toolLimit} 个调用，已跳过`, '超过单工具上限'));
      continue;
    }
    try {
      const receipt = await tool.run(state, call.args, ctx);
      receipts.push(receipt);
      if (receipt.kind === 'done') ctx.perTool[call.tool] = (ctx.perTool[call.tool] ?? 0) + 1;
    } catch (e) {
      console.warn(`[organizer] 工具 ${call.tool} 执行异常:`, (e as Error).message);
      receipts.push(skipped(call.tool, `工具 ${call.tool} 执行失败，已跳过`, (e as Error).message));
    }
  }
  return receipts;
}

// ── Organizer 主类 ──────────────────────────────────

export class Organizer {
  constructor(private llm: LLMClient) {}

  /**
   * 异步入口：立即返回 organizeId，整理在后台进行。
   * 调用方（POST /api/chat）不得 await 整理完成。
   */
  run(input: OrganizerRunInput): string {
    const id = uid('org');
    this.execute(id, input).catch((e) => {
      console.warn('[organizer] 未捕获异常:', (e as Error).message);
    });
    return id;
  }

  private async execute(id: string, input: OrganizerRunInput): Promise<void> {
    // 1. pending 记录先落库：保证 LLM 运行期间乃至服务重启后，前端轮询都能拿到状态
    {
      const state = await loadState();
      state.organizeResults.push({
        id,
        messageId: input.messageId,
        createdAt: nowIso(),
        status: 'pending',
        receipts: [],
      });
      if (state.organizeResults.length > MAX_RECORDS) {
        state.organizeResults = state.organizeResults.slice(-MAX_RECORDS);
      }
      await saveState(state);
    }

    try {
      if (!this.llm.configured) throw new Error('LLM not configured (LLM_API_KEY missing)');
      // 2. LLM 独立 JSON 调用（此阶段不写任何数据），输出 tool_calls
      const raw = await this.llm.chatJSON<unknown>(
        [
          { role: 'system', content: '你是 LifeOS 整理引擎，只输出 JSON。' },
          { role: 'user', content: buildPrompt(input) },
        ],
        { json: true, timeoutMs: ORGANIZE_TIMEOUT_MS, temperature: 0.2, maxTokens: 2000, task: 'organize' },
      );
      const calls = sanitizeToolCalls(raw);
      console.log(`[organizer] ${id} LLM 输出:`, JSON.stringify(raw).slice(0, 300));

      // 3. 重新加载最新状态，逐个执行工具并收集回执，再一次落库
      const state = await loadState();
      const receipts = await runToolCalls(state, calls, input.messageId);
      const rec = state.organizeResults.find((r) => r.id === id);
      if (rec) {
        rec.receipts = receipts;
        rec.status = 'done';
      }
      await saveState(state);
      console.log(
        `[organizer] ${id} done: 调用 ${calls.length} 个 → ` +
        `成功 ${receipts.filter((r) => r.kind === 'done').length}` +
        ` / 跳过 ${receipts.filter((r) => r.kind === 'skipped').length}` +
        ` / 建议 ${receipts.filter((r) => r.kind === 'suggestion').length}`,
      );
      // 画像层写端触发：未入画像的活跃记忆 ≥ 阈值 → 异步重写（不阻塞整理返回，失败保留旧画像）
      if (unsyncedProfileMemories(state).length >= PROFILE_REWRITE_THRESHOLD) {
        rewriteProfileIfDue(this.llm).catch(() => {});
      }
    } catch (e) {
      // 失败路径：只标 failed，不留脏数据（工具执行之前的阶段不产生任何写入）
      console.warn(`[organizer] ${id} 整理失败:`, (e as Error).message);
      try {
        const state = await loadState();
        const rec = state.organizeResults.find((r) => r.id === id);
        if (rec) {
          rec.status = 'failed';
          await saveState(state);
        }
      } catch (e2) {
        console.warn('[organizer] failed 状态落库失败:', (e2 as Error).message);
      }
    }
  }
}

// ── 撤销 ──────────────────────────────────

export interface UndoOutcome {
  ok: true;
  /** 已撤销项的 summary 列表 */
  undone: string[];
  /** 不可撤销/未撤销项的 summary 列表 */
  skipped: string[];
}

/**
 * 撤销一轮整理结果（按 receipts 逐个撤销，只撤销未被用户动过的）：
 * ─ add_task：任务仍 status:'todo' 才删
 * ─ complete_task：任务仍 status:'done' 才恢复 todo
 * ─ create_version：版本仍在才删；删除时同步解除打包（memoryIds 里记忆的 versionId 移除，恢复未提交状态）
 * ─ create_thread：autoCreated 线程无 lastTouchedAt 且线程下无任务才删
 * ─ record_memory：detail='created' 的记忆仍 active 且未 superseded 才删；confirmed 的不可撤销
 * ─ record_knowledge：知识条目仍在才删
 * ─ record_fragment：直接删
 * ─ fill_checkin / update_thread / suggestion：不可撤销
 * 撤销后 result 标 undone: true。记录不存在返回 null。
 * 旧的六桶式记录没有 receipts，按空数组处理（无可撤销项）。
 */
export async function undoOrganize(id: string): Promise<UndoOutcome | null> {
  const state = await loadState();
  const rec = state.organizeResults.find((r) => r.id === id);
  if (!rec) return null;
  if (rec.status !== 'done' || rec.undone) return { ok: true, undone: [], skipped: [] };

  const undone: string[] = [];
  const skippedList: string[] = [];
  const receipts: Receipt[] = Array.isArray(rec.receipts) ? rec.receipts : [];

  for (const r of receipts) {
    // 建议与未执行的调用不产生任何写入，无撤销对象
    if (r.kind === 'suggestion') {
      skippedList.push(r.summary);
      continue;
    }
    if (r.kind !== 'done') continue;

    switch (r.tool) {
      case 'add_task': {
        const idx = state.tasks.findIndex((x) => x.id === r.refId);
        if (idx < 0) { skippedList.push(r.summary); break; }
        if (state.tasks[idx].status !== 'todo') { skippedList.push(r.summary); break; }
        state.tasks.splice(idx, 1);
        undone.push(r.summary);
        break;
      }
      case 'complete_task': {
        const task = state.tasks.find((x) => x.id === r.refId);
        if (!task || task.status !== 'done') { skippedList.push(r.summary); break; }
        task.status = 'todo';
        undone.push(r.summary);
        break;
      }
      case 'update_task': {
        const task = state.tasks.find((x) => x.id === r.refId);
        if (!task || !r.undoPayload) { skippedList.push(r.summary); break; }
        task.date = r.undoPayload.date ?? task.date;
        task.title = r.undoPayload.title ?? task.title;
        undone.push(r.summary);
        break;
      }
      case 'create_version': {
        const idx = state.lifeVersions.findIndex((x) => x.id === r.refId);
        if (idx < 0) { skippedList.push(r.summary); break; }
        // 解除打包：把 memoryIds 里记忆的 versionId 标记移除（恢复未提交状态）
        const ver = state.lifeVersions[idx];
        if (Array.isArray(ver.memoryIds)) {
          const idSet = new Set(ver.memoryIds);
          for (const m of state.memories) {
            if (idSet.has(m.id) && m.versionId === ver.id) delete m.versionId;
          }
        }
        state.lifeVersions.splice(idx, 1);
        undone.push(r.summary);
        break;
      }
      case 'create_thread': {
        const idx = state.threads.findIndex((x) => x.id === r.refId);
        if (idx < 0) { skippedList.push(r.summary); break; }
        const thread = state.threads[idx];
        if (thread.lastTouchedAt || state.tasks.some((x) => x.threadId === thread.id)) {
          skippedList.push(r.summary);
          break;
        }
        state.threads.splice(idx, 1);
        undone.push(r.summary);
        break;
      }
      case 'record_memory': {
        if (r.detail !== 'created') { skippedList.push(r.summary); break; } // confirmed 不可撤销
        const idx = state.memories.findIndex((x) => x.id === r.refId);
        if (idx < 0) { skippedList.push(r.summary); break; }
        const mem = state.memories[idx];
        if (!mem.active || mem.superseded) { skippedList.push(r.summary); break; }
        state.memories.splice(idx, 1);
        await deleteMemoryMd(mem.id);
        undone.push(r.summary);
        break;
      }
      case 'record_knowledge': {
        const idx = state.knowledge.findIndex((x) => x.id === r.refId);
        if (idx < 0) { skippedList.push(r.summary); break; }
        state.knowledge.splice(idx, 1);
        undone.push(r.summary);
        break;
      }
      case 'record_fragment': {
        if (!r.refId) { skippedList.push(r.summary); break; }
        const n = await deleteCaptures([r.refId]);
        if (n > 0) undone.push(r.summary);
        else skippedList.push(r.summary);
        break;
      }
      default:
        // fill_checkin（用户可手改）/ update_thread（状态恢复有歧义）/ 未知工具：不可撤销
        skippedList.push(r.summary);
    }
  }

  rec.undone = true;
  await saveState(state);
  console.log(`[organizer] ${id} undone: ${undone.length} 项，跳过 ${skippedList.length} 项`);
  return { ok: true, undone, skipped: skippedList };
}
