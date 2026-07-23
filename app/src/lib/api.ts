/**
 * LifeOS Server API 客户端（契约：docs/api-contract.md）
 * ─────────────────────────────────────────────────────────────
 * - 全部走相对路径 `/api`，由 Vite proxy 转发到 http://localhost:3456。
 * - 统一错误处理：网络层失败（fetch reject）视为 server 不可达；
 *   HTTP 非 2xx 抛 ApiHttpError（server 可达但请求失败，两者语义不同）。
 * - useServerStatus：供 UI 订阅的在线/LLM 状态（ChatPage 顶部标识用）。
 * - 本模块不 import store.ts（避免循环依赖），状态迁移逻辑在 store.ts。
 */

import { create } from 'zustand';
import type {
  AgentAction, ChatMessage, DailyState, EnergyLevel, Goal,
  LifeVersion, MemoryEntry, Task, Thread, ThreadProposal, User, UserProfile, Vision,
} from '@/types';
import type { SeedData } from './seed';

/** GET/PUT /api/state 的全量状态：契约新增 threads / profile 字段（server 并行开发，老 server 可能缺省） */
export type StateData = SeedData & { threads?: Thread[]; profile?: UserProfile };

// ── Base URL 解析 ──────────────────────────────────
// 默认走相对路径 `/api`（同源）：单端口部署（server 托管 dist/）和
// Vite dev proxy 都被覆盖。若 localStorage 存在 lifeos-server-url
// 则用它作为后端地址 —— 用于 APK 离线包场景（WebView 加载打包资产，
// 无同源后端）或连接局域网内另一台机器的后端。
const SERVER_URL_KEY = 'lifeos-server-url';

/** 读取用户配置的后端地址；空串/未设置 = 同源相对路径 */
export function getServerUrl(): string {
  try {
    return (localStorage.getItem(SERVER_URL_KEY) ?? '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** 设置后端地址（如 http://192.168.1.10:3456）；传空串恢复同源模式 */
export function setServerUrl(url: string): void {
  try {
    const normalized = url.trim().replace(/\/+$/, '');
    if (normalized) localStorage.setItem(SERVER_URL_KEY, normalized);
    else localStorage.removeItem(SERVER_URL_KEY);
  } catch {
    // localStorage 不可用（隐私模式等）：静默忽略，回落同源
  }
}

function baseUrl(): string {
  return `${getServerUrl()}/api`;
}

// ── 错误类型 ──────────────────────────────────

/** server 可达但返回非 2xx（区别于网络不可达） */
export class ApiHttpError extends Error {
  readonly status: number;
  constructor(status: number, path: string) {
    super(`API ${path} → HTTP ${status}`);
    this.name = 'ApiHttpError';
    this.status = status;
  }
}

/** 409 冲突：server 拒绝写入并给出人类可读的 hint（如活跃线程 ≥5 时"先挂起一条"） */
export class ApiConflictError extends ApiHttpError {
  readonly hint?: string;
  constructor(path: string, hint?: string) {
    super(409, path);
    this.name = 'ApiConflictError';
    this.hint = hint;
  }
}

/** 线程写入专用请求：409 时解析 body { error, hint } 抛 ApiConflictError，其余同 request() */
async function threadRequest<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    let hint: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; hint?: string };
      hint = data.hint ?? data.error;
    } catch {
      // body 非 JSON：hint 缺省
    }
    throw new ApiConflictError(path, hint);
  }
  if (!res.ok) throw new ApiHttpError(res.status, path);
  return (await res.json()) as T;
}

// ── Server 在线状态（UI 可订阅） ──────────────────────────────────

export interface ServerStatus {
  /** server 是否可达 */
  online: boolean;
  /** server 是否配置了可用 LLM key */
  llm: boolean;
  /** 是否已完成至少一次健康检查 */
  checked: boolean;
}

export const useServerStatus = create<ServerStatus>(() => ({
  online: false,
  llm: false,
  checked: false,
}));

export function isServerOnline(): boolean {
  return useServerStatus.getState().online;
}

/** 网络层失败时由同步逻辑调用，回落离线模式（静默，不打扰 UI） */
export function markServerOffline(): void {
  const s = useServerStatus.getState();
  if (s.online) useServerStatus.setState({ online: false, llm: false, checked: true });
}

// ── 统一请求封装 ──────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // fetch 网络失败会抛 TypeError —— 原样上抛，由调用方判定"不可达"
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new ApiHttpError(res.status, path);
  return (await res.json()) as T;
}

const post = <T,>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) });

const patch = <T,>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

// ── 健康检查 ──────────────────────────────────

export interface HealthResult {
  ok: boolean;
  llm: boolean;
  version: string;
}

/** 探测 server 在线与 LLM 可用性，结果写入 useServerStatus。永不抛异常。 */
export async function checkHealth(): Promise<ServerStatus> {
  try {
    const data = await request<HealthResult>('/health');
    const status: ServerStatus = { online: data.ok === true, llm: !!data.llm, checked: true };
    useServerStatus.setState(status);
    return status;
  } catch {
    const status: ServerStatus = { online: false, llm: false, checked: true };
    useServerStatus.setState(status);
    return status;
  }
}

// ── 契约端点 ──────────────────────────────────

interface OkResponse {
  ok: boolean;
}

// ── 对话整理管线（chat → organize） ──────────────────────────────────

export interface ChatApiResult {
  reply: string;
  actions?: AgentAction[];
  /** 本轮对话的整理任务 id（回复同步返回，整理异步进行，轮询 GET /api/organize/:id） */
  organizeId: string;
  /** server 落库的 agent 消息 id；前端本地消息必须复用这个 id，否则 initServerSync 替换消息列表后「已整理」卡片会失去挂载点 */
  agentMessageId?: string;
  /** 90s 内重复消息命中防双发时返回 true */
  deduped?: boolean;
}

/**
 * 整理回执：整理管线每个动作的一条结果记录。
 * - kind='done'：动作已执行，按 tool 展示图标 + summary，detail 可展开；
 * - kind='skipped'：动作被跳过，灰字 + skipReason；
 * - kind='suggestion'：建议（tool='suggest_thread'），由用户确认后执行。
 */
export interface Receipt {
  tool: string;
  summary: string;
  detail?: string;
  refId?: string;
  kind: 'done' | 'skipped' | 'suggestion';
  skipReason?: string;
}

/** GET /api/organize/:id 返回的整理结果 */
export interface OrganizeResult {
  id: string;
  messageId: string;
  createdAt: string;
  receipts: Receipt[];
  /** true 表示这次整理已被撤销 */
  undone?: boolean;
}

/** GET /api/organize/:id 的响应 */
export interface OrganizeStatus {
  status: 'pending' | 'done' | 'failed';
  result?: OrganizeResult;
}

/** POST /api/organize/:id/undo 的响应 */
export interface OrganizeUndoResult {
  ok: boolean;
  undone: string[];
  skipped: string[];
}

// ── 随手记（capture） ──────────────────────────────────

/** POST /api/capture 返回的 echo：server 从碎片中归档出的各维度条目 */
export interface CaptureEcho {
  facts: unknown[];
  insights: unknown[];
  tasks: unknown[];
  openLoops: unknown[];
  stateSignals: unknown[];
  knowledge: unknown[];
}

export interface CaptureResult {
  captured: boolean;
  /** true 表示 server 只做了原文保存，尚未整理 */
  degraded?: boolean;
  echo: CaptureEcho;
}

/** GET /api/captures?date=YYYY-MM-DD 的单条碎片 */
export interface CaptureItem {
  id: string;
  ts: string;
  text: string;
  source?: string;
}

/**
 * GET /api/captures 的响应。server 实际返回 { date, captures: [...] }；
 * 兼容早期直接返回数组的形态。
 */
export type CapturesResponse = CaptureItem[] | { date?: string; captures?: CaptureItem[] };

// ── memex 同步（导入） ──────────────────────────────────

/** GET /api/import/status 的返回：同步目录监听与导入统计 */
export interface ImportStatus {
  /** server 监听的 memex 同步目录 */
  syncDir: string;
  /** 当前监听到的文件数 */
  watchedFiles: number;
  /** 累计导入条目总数 */
  importedTotal: number;
  /** 最近一次导入时间（ISO 字符串），尚无导入为 null */
  lastImportAt: string | null;
  /** 最近一次导入错误信息，无错误为 null */
  lastError: string | null;
}

/** POST /api/import/memex 的返回：历史备份导入结果 */
export interface ImportResult {
  imported: { memories: number; tasks: number; knowledge: number };
  /** 因重复被跳过的条数 */
  skipped: number;
  errors: string[];
  /** 导入后自动梳理出的线程数（0 = 已有线程或未触发） */
  threadsDerived?: number;
}

// ── Dream（夜间跨记录归纳） ──────────────────────────────────

/** GET /api/dream/latest / POST /api/dream/run 的归纳报告 */
export interface DreamGoalProgress {
  goal: string;
  evidence: string;
}

export interface DreamReport {
  date: string;
  summary: string;
  themes: string[];
  goalProgress: Array<DreamGoalProgress | string>;
  drainers: string[];
  suggestion: string;
}

/** POST /api/dream/run：生成新归纳；数据不足时 server 可能返回 { skipped: true } */
export type DreamRunResult = DreamReport | { skipped: true };

// ── 手机访问入口（契约：GET /api/access-info → { port, lanUrls }） ──────────────────────────────────

/** GET /api/access-info 的返回：后端端口与局域网可访问地址列表 */
export interface AccessInfo {
  port: number;
  lanUrls: string[];
}

export const api = {
  // 全量状态
  getState: () => request<StateData>('/state'),
  putState: (state: StateData) =>
    request<OkResponse>('/state', { method: 'PUT', body: JSON.stringify(state) }),

  // 线程（409 时抛 ApiConflictError，携带 server hint）
  createThread: (thread: Thread) => threadRequest<OkResponse>('/threads', 'POST', thread),
  updateThread: (threadId: string, patchBody: Partial<Thread>) =>
    threadRequest<OkResponse>(`/threads/${threadId}`, 'PATCH', patchBody),
  deriveThreads: () => post<{ proposals: ThreadProposal[] }>('/threads/derive', {}),

  // 日常状态（幂等 upsert）
  addDailyState: (state: DailyState) => post<OkResponse>('/daily-states', state),

  // 任务
  addTask: (task: Task) => post<OkResponse>('/tasks', task),
  updateTask: (taskId: string, patchBody: Partial<Task>) =>
    patch<OkResponse>(`/tasks/${taskId}`, patchBody),

  // 目标
  addGoal: (goal: Goal) => post<OkResponse>('/goals', goal),
  updateGoal: (goalId: string, patchBody: Partial<Goal>) =>
    patch<OkResponse>(`/goals/${goalId}`, patchBody),

  // 人生版本
  addLifeVersion: (version: LifeVersion) => post<OkResponse>('/life-versions', version),

  // 记忆
  addMemory: (entry: MemoryEntry) => post<OkResponse>('/memories', entry),
  updateMemory: (memoryId: string, patchBody: Partial<MemoryEntry>) =>
    patch<OkResponse>(`/memories/${memoryId}`, patchBody),

  // 对话消息
  addChatMessage: (message: ChatMessage) => post<OkResponse>('/chat-messages', message),

  // 能量模式
  setEnergyMode: (level: EnergyLevel, reason: string) =>
    post<OkResponse>('/energy-mode', { level, reason }),

  // 用户
  updateUser: (patchBody: Partial<User>) => post<OkResponse>('/users', patchBody),

  // 愿景
  addVision: (vision: Vision) => post<OkResponse>('/visions', vision),
  updateVision: (visionId: string, patchBody: Partial<Vision>) =>
    patch<OkResponse>(`/visions/${visionId}`, patchBody),

  // AI 对话（server 侧真实 LLM，失败时 server 自行回落规则引擎）
  chat: (input: string) => post<ChatApiResult>('/chat', { input }),

  // 对话整理管线：轮询整理状态 / 撤销整理
  getOrganize: (organizeId: string) =>
    request<OrganizeStatus>(`/organize/${encodeURIComponent(organizeId)}`),
  undoOrganize: (organizeId: string) =>
    post<OrganizeUndoResult>(`/organize/${encodeURIComponent(organizeId)}/undo`, {}),

  // 随手记（移动端 /capture 页）
  capture: (text: string, source?: string) => post<CaptureResult>('/capture', { text, source }),
  // server 返回 { date, captures }（兼容旧形态数组），统一归一化为数组，
  // 否则调用方数组展开会在渲染期抛 TypeError 导致整树卸载（/capture 白屏的根因）
  getCaptures: async (date: string): Promise<CaptureItem[]> => {
    const data = await request<CapturesResponse>(
      `/captures?date=${encodeURIComponent(date)}`,
    );
    if (Array.isArray(data)) return data;
    return Array.isArray(data?.captures) ? data.captures : [];
  },

  // memex 同步（契约：docs/api-contract.md）
  getImportStatus: () => request<ImportStatus>('/import/status'),
  importMemex: (zipPath: string) => post<ImportResult>('/import/memex', { zipPath }),
  rescanImport: () => post<ImportStatus>('/import/rescan', {}),

  // Dream 夜间归纳（TodayPage DreamCard）
  getLatestDream: () => request<DreamReport | null>('/dream/latest'),
  runDream: () => post<DreamRunResult>('/dream/run', {}),

  // 手机访问入口：局域网地址列表（server 未上线此接口时由调用方兜底）
  getAccessInfo: () => request<AccessInfo>('/access-info'),
};
