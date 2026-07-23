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
  /** 用户自书的人生愿景原文（自由文本，区别于结构化 Vision 实体） */
  visionText?: string;
  settings: {
    timezone: string;
    checkInReminderTime?: string;
  };
}

/**
 * 用户画像：server 整理管线生成的 ≤800 字 Markdown 摘要，
 * 固定四节：# 核心身份 / # 价值观与偏好 / # 稳定模式 / # 当前关注。
 * GET /api/state 响应的 profile 字段（server 并行开发，老 server 缺省）。
 */
export interface UserProfile {
  /** Markdown 正文 */
  content: string;
  /** 最近一次画像更新时间（ISO 8601） */
  updatedAt: string;
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
  /** 打卡来源：manual=用户手动打卡 / auto=整理管线自动记录（老数据缺省视为 manual） */
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
  /** 所属线程（线程模型收敛后的主挂载点，server 端回填） */
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
  createdAt: string;
  /** 本次提交打包的长期记忆 id 列表（commit 内容，UI 展开可查） */
  memoryIds?: string[];
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
  /** 被后续对话/记录再次确认的次数（>1 时 UI 显示「确认×N」徽标） */
  confirmCount?: number;
  /** 最近一次被打包进的 LifeVersion id；为空，或对应版本 createdAt 早于
   *  lastConfirmedAt（提交后又被重新确认）时，视为未提交变更 */
  versionId?: string;
}

// ─────────────────────────────────────────────
// 线程（Thread）：人生里正在进行的事
// 契约见 docs/api-contract.md —— POST /api/threads、PATCH /api/threads/:id、
// POST /api/threads/derive。挂起不是放弃，是托管。
// ─────────────────────────────────────────────

/** 线程领域：职业 / 创造 / 关系 / 自我 */
export type ThreadDomain = 'career' | 'creation' | 'relationship' | 'self';

/** 线程状态：进行中 / 已挂起（托管） / 已完结 / 已释放 */
export type ThreadStatus = 'active' | 'parked' | 'done' | 'dropped';

export interface Thread {
  id: string;
  userId: string;
  title: string;
  domain: ThreadDomain;
  status: ThreadStatus;
  /** 一句话备注：这条线程现在意味着什么 */
  note?: string;
  /** 证据来源：MemoryEntry/DailyState/Goal 等的 id 列表 */
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
  /** 最近一次触碰（创建/编辑/状态变更）时间 */
  lastTouchedAt?: string;
  /** 由对话整理管线自动创建的线程（UI 显示「自动」小徽标） */
  autoCreated?: boolean;
}

/** POST /api/threads/derive 返回的单条提议（不落库，用户勾选后逐条创建） */
export interface ThreadProposal {
  title: string;
  domain: ThreadDomain;
  note?: string;
  evidenceSummary: string;
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
  /** 归属线程 id（契约新增；UI 显示线程小徽标） */
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
  /** Agent 回复对应的异步整理任务；用于跨页面恢复整理回执卡 */
  organizeId?: string;
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

/** Agent 可对系统执行的动作（server 回复通道已瘦身：仅保留 set_mode / apply_plan / freeze_plan，
 *  本地规则引擎离线时仍可能给出 defer_task / keep_task / split_task） */
export interface AgentAction {
  type: 'set_mode' | 'defer_task' | 'keep_task' | 'split_task' | 'freeze_plan' | 'apply_plan';
  /** 动作的人类可读说明，用于 UI 按钮文案 */
  label: string;
  taskId?: string;
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
  knowledge?: KnowledgeItem[];
}

export interface ChatResult {
  reply: string;
  actions?: AgentAction[];
}
