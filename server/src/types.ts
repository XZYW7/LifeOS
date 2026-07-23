/**
 * LifeOS 共享类型契约层
 * ─────────────────────────────────────────────────────────────
 * 本文件由脚手架工程师维护，页面 worker 只读不改。
 * 实体定义源自 design/03-data-model.md，Agent 类型源自 design/04-ai-agent.md。
 */

// ─────────────────────────────────────────────
// 基础枚举（union 类型，兼容 erasableSyntaxOnly）
// ─────────────────────────────────────────────

/** 能量档位：high=高性能 / medium=平衡 / low=省电 */
export type EnergyLevel = 'high' | 'medium' | 'low';

/** 目标尺度：vision→year→month→week→day 五层对齐链 */
export type GoalScale = 'vision' | 'year' | 'month' | 'week' | 'day';

export type GoalStatus = 'planned' | 'active' | 'done' | 'dropped' | 'deferred';

export type TaskStatus = 'todo' | 'done' | 'skipped';

// ── 线程模型（收敛核心：替代愿景/年/月/周/日五层目标树）──

/** 线程领域：career/creation 为消耗型领域（各最多 2 条活跃） */
export type ThreadDomain = 'career' | 'creation' | 'relationship' | 'self';

/** 线程状态：parked（挂起）是一等公民状态——托管 ≠ 欠债 */
export type ThreadStatus = 'active' | 'parked' | 'done' | 'dropped';

/** 线程：人生里正在进行的事。活跃软上限 5 条。 */
export interface Thread {
  id: string;
  userId: string;
  title: string;
  domain: ThreadDomain;
  status: ThreadStatus;
  note?: string;
  /** 证据来源：Memory/Capture/Task 的 id 列表 */
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
  /** 最近一次被"照顾"（完成行动/对话关联/随手记关联）的时间 */
  lastTouchedAt?: string;
  /** Organizer 对话整理自动创建（撤销时只对未被用户碰过的 autoCreated 线程生效） */
  autoCreated?: boolean;
}

/** 记忆类型：fact=客观事实 / pattern=行为模式 / insight=Agent 洞察 */
export type MemoryKind = 'fact' | 'pattern' | 'insight';

export type Confidence = 'low' | 'medium' | 'high';

// ─────────────────────────────────────────────
// 实体
// ─────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  createdAt: string; // ISO 8601
  currentEnergyMode: EnergyLevel;
  /** 人生阶段定性标签，如 "职业转换期"、"探索期" */
  lifeStageTag?: string;
  /** 愿景降级为用户资料里的一句话（原 Vision 实体的平替） */
  visionText?: string;
  settings: {
    timezone: string;
    checkInReminderTime?: string;
  };
}

/** 长期人生方向（北极星，不设 deadline、不设进度百分比） */
export interface Vision {
  id: string;
  userId: string;
  title: string;
  /** 自然语言描述：为什么是这个方向，供 Agent 语义对齐 */
  narrative: string;
  horizon: '3y' | '5y' | 'life';
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
  updatedAt: string;
}

/**
 * 多尺度目标树节点。
 * 对齐规则：parentId 只能指向相邻上层（day→week→month→year→vision），
 * year/vision 层额外持有 visionId 锚定 Vision 实体。
 */
export interface Goal {
  id: string;
  userId: string;
  scale: GoalScale;
  title: string;
  /** 上层目标 id（对齐链） */
  parentId?: string;
  /** 仅 year/vision 层必填，锚定 Vision */
  visionId?: string;
  /** "2026" | "2026-07" | "2026-W28" | "2026-07-09" */
  period: string;
  status: GoalStatus;
  /** 结束时的定性复盘，如 "完成70%，方向验证成功" */
  outcomeNote?: string;
  createdAt: string;
}

export interface Project {
  id: string;
  userId: string;
  title: string;
  /** 服务的 Goal（通常 month/year 层） */
  goalIds: string[];
  status: 'idea' | 'active' | 'shipped' | 'parked';
  outputLinks?: string[];
  createdAt: string;
}

/** 五维状态单维表示：定性标签 + 轻度量化（1-5，仅用于趋势，不展示为分数） */
export interface DimensionState {
  /** 定性标签，如 "恢复不足"、"心流频发" */
  tag: string;
  /** 轻度自评 1-5（可选） */
  level?: 1 | 2 | 3 | 4 | 5;
  /** 用户一句话描述 */
  note?: string;
}

export interface DailyState {
  id: string;
  userId: string;
  /** "2026-07-09"，按日期唯一 */
  date: string;
  /** 当日总体能量自评 */
  energy: EnergyLevel;
  body: DimensionState;
  emotion: DimensionState;
  social: DimensionState;
  creative: DimensionState;
  learning: DimensionState;
  /** 睡眠时长（小时），用于 R2 恢复需求判定 */
  sleepHours?: number;
  /** 自由记录，如 "今天很累" */
  note?: string;
  /** Agent 自然语言解读 */
  agentReading?: string;
  /** Agent 建议的能量档位 */
  suggestedMode?: EnergyLevel;
  /** 打卡来源：manual=用户手动打卡（Organizer 绝不覆盖）；auto=Organizer 从对话推断。缺省视为 manual */
  source?: 'manual' | 'auto';
}

export interface EnergyModeRecord {
  level: EnergyLevel;
  from: string;
  to?: string;
  reason: string;
}

export interface EnergyMode {
  userId: string;
  current: EnergyLevel;
  /** 本档位生效日期 */
  effectiveFrom: string;
  /** 切换原因（用户声明或 Agent 建议） */
  reason: string;
  history: EnergyModeRecord[];
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  /** 所属 Goal（通常 day 层，强制对齐，杜绝无源任务） */
  goalId?: string;
  /** 所属线程（线程模型收敛后的主挂载点） */
  threadId?: string;
  projectId?: string;
  /** 预估能量消耗，供低功耗模式过滤（mode 适配） */
  energyCost: 'low' | 'medium' | 'high';
  status: TaskStatus;
  /** 计划执行日 "2026-07-09" */
  date: string;
  /** 维持性任务（低功耗模式下仍保留） */
  isMaintenance?: boolean;
  /** 最小连接行动：低功耗模式下为长期目标保留的 ≤15min 轻量行动 */
  isMinimalConnection?: boolean;
  /** 被顺延到的日期 */
  deferredTo?: string;
  /** 顺延原因（如 recovery / motivation） */
  deferReason?: string;
}

/** 人生版本记录（Git commit 语义：过去的我不是消失了，而是更新了） */
export interface LifeVersion {
  id: string;
  userId: string;
  /** 版本名，如 "2026-07" 或用户命名 "gap-month-v1" */
  version: string;
  /** 版本日期（发布日） */
  date: string;
  period?: { from: string; to: string };
  /** 发生了什么（关键事件） */
  happened: string[];
  /** 获得了什么（能力/作品/关系） */
  gained: string[];
  /** 放弃了什么（目标/执念/身份），与 gained 同等重要 */
  released: string[];
  /** Agent 生成的版本小结 */
  summary: string;
  statsSnapshot?: {
    activeDays: number;
    dominantEmotionTag?: string;
    modeChanges: number;
  };
  /** 本次提交打包的记忆 id 列表（git commit 语义：版本包含当时全部活跃记忆） */
  memoryIds?: string[];
  createdAt: string;
}

/**
 * 用户画像（memex 摘要层）：从条目记忆（证据层）蒸馏出的 ≤800 字 Markdown 画像。
 * 证据层（MemoryEntry + confirmCount + 版本提交）保留全量；画像丢了可从证据层重建。
 * 写端控制体积（仅触发式重写），读端全量注入上下文。
 */
export interface UserProfile {
  /** 中文 Markdown，固定四节：# 核心身份 / # 价值观与偏好 / # 稳定模式 / # 当前关注 */
  content: string;
  /** 上次重写时间（ISO 8601）；lastConfirmedAt 晚于它的活跃记忆视为「未入画像的新记忆」 */
  updatedAt: string;
}

/** Agent 长期记忆条目 */
export interface MemoryEntry {
  id: string;
  userId: string;
  kind: MemoryKind;
  /** 自然语言一条 */
  content: string;
  /** 证据来源：DailyState/Goal/Task 的 id 列表 */
  sourceRefs: string[];
  confidence: Confidence;
  /** 被新证据推翻时标记 true（保留审计轨迹，不物理删除） */
  superseded: boolean;
  active: boolean;
  firstSeenAt: string;
  lastConfirmedAt: string;
  /** 被后续对话再次确认的次数（Organizer 判重时 +1） */
  confirmCount?: number;
  /** 该记忆被提交进的版本 id（无 versionId 即未提交，旧数据缺省兼容） */
  versionId?: string;
}

export interface KnowledgeItem {
  id: string;
  userId: string;
  /** 可复用内容的形态，不限于学术知识；旧值保持兼容。 */
  type: 'note' | 'method' | 'experience' | 'recipe' | 'guide' | 'resource' | 'paper' | 'idea' | 'learning-log';
  title: string;
  /** Markdown 正文 */
  content: string;
  goalIds: string[];
  projectIds: string[];
  /** Memex PARA 目录或其等价归档位置。 */
  para?: 'project' | 'area' | 'resource' | 'archive';
  /** 关联线程（知识服务人生方向；按主题沉淀到线程） */
  threadId?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'agent';
  content: string;
  /** Agent 回复附带的对系统的动作建议 */
  actions?: AgentAction[];
  createdAt: string;
}

// ─────────────────────────────────────────────
// Agent 规则引擎类型（design/04-ai-agent.md R1-R5）
// ─────────────────────────────────────────────

/** 状态归因结论：恢复需求 / 动力不足 / 情绪性低落 / 常规日 */
export type DiagnosisType = 'recovery' | 'motivation' | 'emotional_low' | 'normal';

export interface AgentAnalysis {
  /** 命中的规则编号，如 "R1"；R5 表示常规日 */
  rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
  diagnosis: DiagnosisType;
  confidence: Confidence | '—';
  /** 判定依据（引用数据的证据串） */
  evidence: string;
  /** 建议的能量模式 */
  suggestedMode: EnergyLevel;
  /** 自然语言推理（观察→归因），引用历史记录 */
  reasoning: string;
  /** 聚合出的行为模式描述 */
  patterns: string[];
  /** 连续高强度天数（截至昨日） */
  consecutiveHighLoadDays: number;
}

/** 今日计划重排结果 */
export interface TodayPlan {
  date: string;
  mode: EnergyLevel;
  /** 保留执行的任务 */
  keptTasks: Task[];
  /** 顺延的任务（已带 deferredTo / deferReason） */
  deferredTasks: Task[];
  /** 为长期目标保留的最小连接行动 */
  minimalConnections: Task[];
  /** 给用户的计划说明（低功耗模式须明确"顺延不是失败"） */
  note: string;
}

/** Agent 可对系统执行的动作 */
export interface AgentAction {
  type: 'set_mode' | 'defer_task' | 'keep_task' | 'add_task' | 'split_task' | 'freeze_plan' | 'apply_plan';
  /** 动作的人类可读说明，用于 UI 按钮文案 */
  label: string;
  taskId?: string;
  task?: Task;
  mode?: EnergyLevel;
  plan?: TodayPlan;
  reason?: string;
}

/** chat() 的上下文快照 */
export interface ChatContext {
  user: User;
  states: DailyState[];
  tasks: Task[];
  goals: Goal[];
  memories: MemoryEntry[];
  /** 规则引擎 fallback 也可查询广义知识库。 */
  knowledge?: KnowledgeItem[];
}

export interface ChatResult {
  reply: string;
  actions?: AgentAction[];
}

// ─────────────────────────────────────────────
// Organizer 异步整理（工具调用层：LLM 输出 tool_calls，服务端逐个执行并收集回执）
// ─────────────────────────────────────────────

/** 单个工具的执行回执（一行人类可读摘要 + 关联实体引用） */
export interface Receipt {
  /** 工具名，如 record_memory / complete_task / create_version */
  tool: string;
  /** 一行人类可读回执，如「已勾掉待办「莉莉丝笔试」→ 求职：游戏引擎岗」 */
  summary: string;
  /** 补充说明（如 skip 时的候选标题、finish 线程时的剩余任务数） */
  detail?: string;
  /** 关联实体 id（任务/线程/记忆/版本/碎片），供 undo 定位 */
  refId?: string;
  /** done=已落库；skipped=未执行；suggestion=建议（不落库，前端渲染确认按钮） */
  kind: 'done' | 'skipped' | 'suggestion';
  skipReason?: string;
  /** 撤销所需的旧值快照（如 update_task 改前的 date/title），仅 undo 使用，前端忽略 */
  undoPayload?: Record<string, string>;
}

/** GET /api/organize/:id 的 result 形状（前端并行开发，字段不得改动） */
export interface OrganizeResult {
  id: string;
  messageId: string;
  createdAt: string;
  receipts: Receipt[];
  /** undo 成功后标记 */
  undone?: boolean;
}

export type OrganizeStatus = 'pending' | 'done' | 'failed';

/** state.organizeResults 里持久化的记录 = 结果 + 轮询状态 */
export interface OrganizeRecord extends OrganizeResult {
  status: OrganizeStatus;
}
