/**
 * LifeOS 全局状态（Zustand + localStorage 持久化 + Server 同步）
 * ─────────────────────────────────────────────────────────────
 * persist key: lifeos-v1。首次启动（无持久化数据）时注入种子数据。
 * 页面 worker 只读不改本文件；通过 useLifeOS hook 与下方 selector 函数取数。
 *
 * Server 同步策略（P0 体验层，契约见 docs/api-contract.md）：
 * - 启动时 initServerSync()：GET /api/state 成功且 server 非空白 → 以 server 为准
 *   整体替换本地（persist 自动写入 localStorage 缓存）；server 空白而本地有数据
 *   → PUT /api/state 一次性迁移本地上云；server 不可达 → 完全回落 localStorage
 *   离线行为，UI 无报错。
 * - 每个 action：先乐观更新本地 zustand，再 fire-and-forget 调对应 API
 *   （失败静默，网络层失败会标记离线；下次启动仍以 server 为准）。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  User, Vision, Goal, DailyState, Task,
  LifeVersion, MemoryEntry, ChatMessage, EnergyLevel,
  TaskStatus, TodayPlan, Thread, UserProfile,
} from '@/types';
import { buildSeed, buildBlank, USER_ID, type SeedData } from './seed';
import { api, checkHealth, useServerStatus, markServerOffline, ApiHttpError, ApiConflictError, type StateData } from './api';

export const STORAGE_KEY = 'lifeos-v1';

export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 计算周期任务下一次执行日；一次性任务不会调用此函数。 */
export function nextRecurringDate(task: Task): string {
  const recurrence = task.recurrence;
  if (!recurrence) return task.date;
  const [y, m, d] = task.date.split('-').map(Number);
  const interval = Math.max(1, recurrence.interval ?? 1);
  const cursor = new Date(y, m - 1, d);

  if (recurrence.frequency === 'daily') cursor.setDate(cursor.getDate() + interval);
  else if (recurrence.frequency === 'monthly') {
    cursor.setMonth(cursor.getMonth() + interval);
  } else if (recurrence.weekdays?.length) {
    const weekdays = new Set(recurrence.weekdays);
    for (let i = 1; i <= 14 * interval; i++) {
      const candidate = new Date(y, m - 1, d);
      candidate.setDate(candidate.getDate() + i);
      if (weekdays.has(candidate.getDay())) {
        cursor.setTime(candidate.getTime());
        break;
      }
    }
  } else cursor.setDate(cursor.getDate() + 7 * interval);

  const nextY = cursor.getFullYear();
  const nextM = String(cursor.getMonth() + 1).padStart(2, '0');
  const nextD = String(cursor.getDate()).padStart(2, '0');
  return `${nextY}-${nextM}-${nextD}`;
}

export function uid(prefix = 'id'): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

// ── Server 同步工具 ──────────────────────────────────

/**
 * fire-and-forget 同步：仅在已知 server 在线时发出。
 * 网络层失败（非 HTTP 错误）→ 静默标记离线；HTTP 错误 → 静默忽略。
 * 任何情况下都不影响本地状态与 UI。
 */
function syncToServer(job: () => Promise<unknown>): void {
  if (!useServerStatus.getState().online) return;
  void job().catch((err: unknown) => {
    if (!(err instanceof ApiHttpError)) markServerOffline();
  });
}

/** 从 store 状态中提取纯数据字段（StateData 形状，剔除 action 函数） */
function pickData(s: LifeOSState): StateData {
  return {
    user: s.user,
    visions: s.visions,
    goals: s.goals,
    projects: s.projects,
    tasks: s.tasks,
    dailyStates: s.dailyStates,
    energyMode: s.energyMode,
    lifeVersions: s.lifeVersions,
    memories: s.memories,
    knowledge: s.knowledge,
    chatMessages: s.chatMessages,
    threads: s.threads,
  };
}

/** 整体同步当前本地状态到 server（resetToSeed / clearToBlank 用） */
function syncFullState(): void {
  syncToServer(() => api.putState(pickData(useLifeOS.getState())));
}

// ── State 形状 ──────────────────────────────────

export interface LifeOSState extends SeedData {
  /** 人生线程（契约新增；server 老版本缺省时为 []） */
  threads: Thread[];
  /** 用户画像（契约新增；server 整理管线生成，仅随 GET /api/state 下发，无画像时为 undefined） */
  profile?: UserProfile;
  // actions
  addDailyState: (state: DailyState) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  completeTask: (taskId: string) => void;
  addTask: (task: Task) => void;
  addGoal: (goal: Goal) => void;
  addLifeVersion: (version: LifeVersion) => void;
  addMemory: (entry: MemoryEntry) => void;
  supersedeMemory: (memoryId: string) => void;
  addChatMessage: (message: ChatMessage) => void;
  setEnergyMode: (level: EnergyLevel, reason: string) => void;
  /**
   * 新建线程：乐观更新 + API 同步。
   * 返回 server 409 的 hint（如活跃 ≥5 时"先挂起一条"），冲突时回滚本地；成功/离线返回 undefined。
   */
  addThread: (thread: Thread) => Promise<string | undefined>;
  /**
   * 更新线程（挂起/恢复/完结/释放/编辑）：乐观更新 + API 同步。
   * 返回 server 409 的 hint，冲突时回滚本地；成功/离线返回 undefined。
   */
  patchThread: (threadId: string, patch: Partial<Thread>) => Promise<string | undefined>;
  /** 修改用户资料（昵称、人生阶段等） */
  updateUser: (patch: Partial<User>) => void;
  /** 新增一条长期愿景 */
  addVision: (vision: Vision) => void;
  /** 编辑长期愿景（标题 / 描述 / 状态等） */
  updateVision: (visionId: string, patch: Partial<Vision>) => void;
  /** 编辑目标（标题 / 状态等），可用来标记 dropped */
  updateGoal: (goalId: string, patch: Partial<Goal>) => void;
  /** 清空为空白档案：保留合法最小结构，不注入演示内容；userName 可预填昵称 */
  clearToBlank: (userName?: string) => void;
  /** 应用 Agent 重排后的今日计划：切模式 + 顺延 + 注入最小连接行动 */
  adjustTodayPlan: (plan: TodayPlan) => void;
  /** 清空并重新注入种子数据（演示用） */
  resetToSeed: () => void;
}

// ── Store ──────────────────────────────────

export const useLifeOS = create<LifeOSState>()(
  persist(
    (set) => ({
      ...buildSeed(),
      threads: [],
      profile: undefined,

      addDailyState: (state) => {
        set((s) => ({ dailyStates: { ...s.dailyStates, [state.date]: state } }));
        syncToServer(() => api.addDailyState(state));
      },

      updateTaskStatus: (taskId, status) => {
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
        }));
        syncToServer(() => api.updateTask(taskId, { status }));
      },

      completeTask: (taskId) => {
        const task = useLifeOS.getState().tasks.find((t) => t.id === taskId);
        if (!task) return;
        const now = new Date().toISOString();
        if (task.kind === 'recurring' && task.recurrence) {
          const nextDate = nextRecurringDate(task);
          set((s) => ({
            tasks: s.tasks.map((t) => t.id === taskId
              ? { ...t, status: 'todo' as const, date: nextDate, lastCompletedAt: now, deferredTo: undefined, deferReason: undefined }
              : t),
          }));
          syncToServer(() => api.updateTask(taskId, {
            status: 'todo', date: nextDate, lastCompletedAt: now, deferredTo: undefined, deferReason: undefined,
          }));
        } else {
          set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, status: 'done' as const } : t)) }));
          syncToServer(() => api.updateTask(taskId, { status: 'done' }));
        }
      },

      addTask: (task) => {
        set((s) => ({ tasks: [...s.tasks, task] }));
        syncToServer(() => api.addTask(task));
      },

      addGoal: (goal) => {
        set((s) => ({ goals: [...s.goals, goal] }));
        syncToServer(() => api.addGoal(goal));
      },

      addLifeVersion: (version) => {
        set((s) => ({ lifeVersions: [...s.lifeVersions, version] }));
        syncToServer(() => api.addLifeVersion(version));
      },

      addMemory: (entry) => {
        set((s) => ({ memories: [...s.memories, entry] }));
        syncToServer(() => api.addMemory(entry));
      },

      supersedeMemory: (memoryId) => {
        set((s) => ({
          memories: s.memories.map((m) =>
            m.id === memoryId ? { ...m, superseded: true, active: false } : m,
          ),
        }));
        syncToServer(() => api.updateMemory(memoryId, { superseded: true, active: false }));
      },

      addChatMessage: (message) => {
        set((s) => ({ chatMessages: [...s.chatMessages, message] }));
        // 不再逐条 POST 同步：在线对话由 server /api/chat 权威落库（user+agent 两条），
        // 这里再同步会因本地 chat-* 与 server msg-* id 不同而产生重复 agent 消息。
        // 离线对话本就同步不出去，保持纯本地即可。
      },

      addThread: async (thread) => {
        set((s) => ({ threads: [...s.threads, thread] }));
        if (!useServerStatus.getState().online) return undefined;
        try {
          await api.createThread(thread);
          return undefined;
        } catch (err) {
          if (err instanceof ApiConflictError) {
            // server 拒绝（如活跃 ≥5）：回滚本地乐观更新，把 hint 交给 UI
            set((s) => ({ threads: s.threads.filter((t) => t.id !== thread.id) }));
            return err.hint ?? '这条线程暂时建不了，先把别的线程挂起或完结。';
          }
          if (!(err instanceof ApiHttpError)) markServerOffline();
          return undefined;
        }
      },

      patchThread: async (threadId, patch) => {
        const prev = useLifeOS.getState().threads.find((t) => t.id === threadId);
        const touched = { ...patch, updatedAt: new Date().toISOString() };
        set((s) => ({
          threads: s.threads.map((t) => (t.id === threadId ? { ...t, ...touched } : t)),
        }));
        if (!useServerStatus.getState().online) return undefined;
        try {
          await api.updateThread(threadId, patch);
          return undefined;
        } catch (err) {
          if (err instanceof ApiConflictError) {
            if (prev) {
              set((s) => ({
                threads: s.threads.map((t) => (t.id === threadId ? prev : t)),
              }));
            }
            return err.hint ?? '这个状态变更被拒绝了。';
          }
          if (!(err instanceof ApiHttpError)) markServerOffline();
          return undefined;
        }
      },

      updateUser: (patch) => {
        set((s) => ({ user: { ...s.user, ...patch } }));
        syncToServer(() => api.updateUser(patch));
      },

      addVision: (vision) => {
        set((s) => ({ visions: [...s.visions, vision] }));
        syncToServer(() => api.addVision(vision));
      },

      updateVision: (visionId, patch) => {
        set((s) => ({
          visions: s.visions.map((v) =>
            v.id === visionId
              ? { ...v, ...patch, updatedAt: new Date().toISOString() }
              : v,
          ),
        }));
        syncToServer(() => api.updateVision(visionId, patch));
      },

      updateGoal: (goalId, patch) => {
        set((s) => ({
          goals: s.goals.map((g) => (g.id === goalId ? { ...g, ...patch } : g)),
        }));
        syncToServer(() => api.updateGoal(goalId, patch));
      },

      clearToBlank: (userName) => {
        set(() => ({ ...buildBlank(userName), threads: [] }));
        try {
          if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
        } catch {}
        syncFullState();
      },

      setEnergyMode: (level, reason) => {
        set((s) => {
          const today = todayStr();
          const history = s.energyMode.history.map((h, i) =>
            i === s.energyMode.history.length - 1 && !h.to ? { ...h, to: today } : h,
          );
          return {
            energyMode: {
              ...s.energyMode,
              current: level,
              effectiveFrom: today,
              reason,
              history: [...history, { level, from: today, reason }],
            },
            user: { ...s.user, currentEnergyMode: level },
          };
        });
        syncToServer(() => api.setEnergyMode(level, reason));
      },

      adjustTodayPlan: (plan) => {
        set((s) => {
          const deferredIds = new Map(plan.deferredTasks.map((t) => [t.id, t]));
          const tasks = s.tasks.map((t) => {
            const d = deferredIds.get(t.id);
            return d ? { ...t, deferredTo: d.deferredTo, deferReason: d.deferReason } : t;
          });
          const existingIds = new Set(tasks.map((t) => t.id));
          const newMinimals = plan.minimalConnections.filter((t) => !existingIds.has(t.id));

          const today = todayStr();
          const history = s.energyMode.history.map((h, i) =>
            i === s.energyMode.history.length - 1 && !h.to ? { ...h, to: today } : h,
          );

          return {
            tasks: [...tasks, ...newMinimals],
            energyMode: {
              ...s.energyMode,
              current: plan.mode,
              effectiveFrom: today,
              reason: plan.note,
              history: [...history, { level: plan.mode, from: today, reason: plan.note }],
            },
            user: { ...s.user, currentEnergyMode: plan.mode },
          };
        });
        syncToServer(async () => {
          // 顺延任务 + 新最小连接行动 + 切模式，逐条幂等 upsert
          await Promise.all([
            ...plan.deferredTasks.map((t) =>
              api.updateTask(t.id, { deferredTo: t.deferredTo, deferReason: t.deferReason }),
            ),
            ...plan.minimalConnections.map((t) => api.addTask(t)),
            api.setEnergyMode(plan.mode, plan.note),
          ]);
        });
      },

      resetToSeed: () => {
        set(() => ({ ...buildSeed(), threads: [] }));
        try {
          if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
        } catch {}
        syncFullState();
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
    },
  ),
);

// ── 启动同步：server 优先，本地上云兜底，离线静默回落 ──────────────────

/** 判断一份状态是否为"空白档案"。曾只查 visions+dailyStates，
 *  清空重导后 server 有 memories/threads 仍被误判空白，触发迁移分支互相覆盖。
 *  现在任一核心集合有数据即视为非空白。 */
function isBlankData(d: {
  visions?: unknown[];
  dailyStates?: Record<string, unknown> | unknown[];
  memories?: unknown[];
  threads?: unknown[];
  tasks?: unknown[];
}): boolean {
  const noStates =
    (Array.isArray(d.dailyStates) ? d.dailyStates.length : Object.keys(d.dailyStates ?? {}).length) === 0;
  return (
    (d.visions?.length ?? 0) === 0 &&
    noStates &&
    (d.memories?.length ?? 0) === 0 &&
    (d.threads?.length ?? 0) === 0 &&
    (d.tasks?.length ?? 0) === 0
  );
}

/**
 * 启动时调用一次：
 * 1. server 不可达 → 离线模式，完全沿用 localStorage，UI 无报错；
 * 2. server 状态为空白（无 visions 且无 dailyStates）而本地有数据
 *    → PUT /api/state 一次性迁移本地上云；
 * 3. server 有数据 → 以 server 为准整体替换本地（persist 自动写 localStorage 缓存）。
 * 永不抛异常。
 */
export async function initServerSync(): Promise<void> {
  const health = await checkHealth();
  if (!health.online) return; // 离线模式：不做任何远端读写
  try {
    const serverState = await api.getState();
    const local = pickData(useLifeOS.getState());
    if (isBlankData(serverState) && !isBlankData(local)) {
      // 首次迁移：本地上云
      await api.putState(local);
    } else if (!isBlankData(serverState)) {
      // 兼容旧版本：整理记录已经落库，但旧 ChatMessage 没有 organizeId。
      // 用 organizeResults.messageId 补回关联，保证历史对话也能显示回执卡。
      const organizeIdByMessage = new Map(
        (serverState.organizeResults ?? []).map((record) => [record.messageId, record.id]),
      );
      const chatMessages = serverState.chatMessages.map((message) => ({
        ...message,
        organizeId: message.organizeId ?? organizeIdByMessage.get(message.id),
      }));
      // 以 server 为准（setState 合并数据字段，action 函数保留）。
      // profile 由 server 整理管线维护：server 缺省时显式置空，避免残留本地缓存的旧画像。
      const messageTimeById = new Map(chatMessages.map((message) => [message.id, message.createdAt]));
      const memories = serverState.memories.map((memory) => ({
        ...memory,
        createdAt: memory.createdAt ?? memory.sourceRefs.map((ref) => messageTimeById.get(ref)).find(Boolean),
      }));
      useLifeOS.setState({ ...serverState, chatMessages, memories, profile: serverState.profile });
    }
    // server 空白且本地也空白：无需动作
  } catch (err) {
    // 网络层失败 → 标记离线；HTTP 错误 → 静默保持本地
    if (!(err instanceof ApiHttpError)) markServerOffline();
  }
}

void initServerSync();

// ── Selectors（纯函数，配合 useLifeOS(selector) 使用） ──────────────────

function sortedStates(s: LifeOSState): DailyState[] {
  return Object.values(s.dailyStates).sort((a, b) => a.date.localeCompare(b.date));
}

/** 今日状态（可能 undefined） */
export const getTodayState = (s: LifeOSState): DailyState | undefined =>
  s.dailyStates[todayStr()];

/** 最近 n 天状态，按日期升序 */
export const getRecentStates = (s: LifeOSState, n: number): DailyState[] =>
  sortedStates(s).slice(-n);

/** 全部状态，按日期升序 */
export const getAllStates = (s: LifeOSState): DailyState[] => sortedStates(s);

/** 连续高强度天数（从昨日向前数，今日不计入） */
export const consecutiveHighIntensityDays = (s: LifeOSState): number => {
  const states = sortedStates(s);
  const today = todayStr();
  let count = 0;
  for (let i = states.length - 1; i >= 0; i--) {
    const st = states[i];
    if (st.date === today) continue;
    if (st.energy === 'high') count++;
    else break;
  }
  return count;
};

/** 今日任务，按能量消耗降序排列（重任务在前） */
export const getTodayTasks = (s: LifeOSState): Task[] => {
  const order = { high: 0, medium: 1, low: 2 };
  return s.tasks
    .filter((t) => t.date === todayStr())
    .sort((a, b) => order[a.energyCost] - order[b.energyCost]);
};

/** 指定日期的任务 */
export const getTasksByDate = (s: LifeOSState, date: string): Task[] =>
  s.tasks.filter((t) => t.date === date);

/** 从某个 Goal 沿 parentId 向上走到顶的对齐链（含自身，自下而上） */
export const getGoalChain = (s: LifeOSState, goalId: string): Goal[] => {
  const chain: Goal[] = [];
  const byId = new Map(s.goals.map((g) => [g.id, g]));
  let cur = byId.get(goalId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
};

/** 当前活跃愿景 */
export const getActiveVision = (s: LifeOSState): Vision | undefined =>
  s.visions.find((v) => v.status === 'active');

/** 活跃且未被推翻的记忆 */
export const getActiveMemories = (s: LifeOSState): MemoryEntry[] =>
  s.memories.filter((m) => m.active && !m.superseded);

export { USER_ID };
export type { SeedData };
