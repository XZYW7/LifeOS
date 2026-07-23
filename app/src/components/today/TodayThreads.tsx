/**
 * 「今天」页 · 线程区（平铺 + 提醒，取代已废弃的 TodayFocusCard 焦点卡）
 * ─────────────────────────────────────────────
 * - 平铺今天有未完成待办的 active 线程，按 lastTouchedAt 最久未照顾的排最前；
 * - 每行：领域徽标 + 标题 + 右侧状态（今天已照顾 ✓ / X 天没碰 / 还没照顾过）+ 待办数徽标；
 * - 点击行展开该线程的待办任务（status=todo），圆圈复选框切换 todo↔done（updateTaskStatus）；
 *   勾选完成 = 照顾：同时 patchThread 写 lastTouchedAt=当前时间，行内立即出现「今天已照顾 ✓」；
 * - 列表下方一句话提醒：GET /api/today-nudge { date, text }（按天缓存）；
 *   请求失败 / server 离线 → 静默不显示这句，不报错。
 * 注意：useLifeOS 选择器只返回原始引用（threads / tasks / actions），
 * 派生数据（排序、过滤、计数）全部走 useMemo，避免新数组引用导致无限渲染。
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, MessageCircleHeart } from 'lucide-react';
import { useLifeOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { DOMAIN_META } from '@/components/threads/domain';
import type { Task, Thread, ThreadDomain } from '@/types';

// ── 领域徽标配色（低饱和暖色，沿用旧卡片的徽标风格；label 取自共享 DOMAIN_META） ──

const DOMAIN_BADGE: Record<ThreadDomain, string> = {
  career: 'border-brand/40 bg-brand/10 text-brand',
  creation: 'border-olive/40 bg-olive/10 text-olive',
  relationship: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  self: 'border-border bg-accent/60 text-muted-foreground',
};

// ── lastTouchedAt 状态文案 ──

/** ISO 时间 → 本地日历日（YYYY-MM-DD） */
function localDateStr(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ENERGY_LABEL: Record<Task['energyCost'], string> = {
  low: '低能耗',
  medium: '中能耗',
  high: '高能耗',
};

function taskDateLabel(date: string, today: string): string {
  return date === today ? `今天 · ${date}` : `执行日 · ${date}`;
}

function recurrenceLabel(task: Task): string | null {
  const rule = task.recurrence;
  if (!rule) return null;
  if (rule.frequency === 'daily') return '每日';
  if (rule.frequency === 'monthly') return '每月';
  if (rule.weekdays?.length) return `每周 ${rule.weekdays.map((day) => ['日', '一', '二', '三', '四', '五', '六'][day]).join('、')}`;
  return '每周';
}

/** 本地日历日 → 当天零点时间戳 */
function dayStartMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

type TouchState = { kind: 'today' } | { kind: 'never' } | { kind: 'stale'; days: number };

function touchState(lastTouchedAt: string | undefined, today: string): TouchState {
  if (!lastTouchedAt) return { kind: 'never' };
  const touchedDay = localDateStr(lastTouchedAt);
  if (touchedDay === today) return { kind: 'today' };
  const days = Math.max(1, Math.round((dayStartMs(today) - dayStartMs(touchedDay)) / 86_400_000));
  return { kind: 'stale', days };
}

// ── today-nudge（后端并行开发中；失败静默） ──

interface TodayNudge {
  date: string;
  text: string;
}

async function fetchTodayNudge(): Promise<TodayNudge | null> {
  try {
    const res = await fetch('/api/today-nudge', {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<TodayNudge>;
    if (typeof data.text !== 'string' || !data.text.trim()) return null;
    return { date: typeof data.date === 'string' ? data.date : '', text: data.text };
  } catch {
    return null; // 网络失败 / server 离线 → 静默
  }
}

export default function TodayThreads() {
  // 选择器只取原始引用，派生数据走 useMemo（防 Zustand 无限渲染）
  const threads = useLifeOS((s) => s.threads);
  const tasks = useLifeOS((s) => s.tasks);
  const updateTaskStatus = useLifeOS((s) => s.updateTaskStatus);
  const completeTask = useLifeOS((s) => s.completeTask);
  const patchThread = useLifeOS((s) => s.patchThread);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nudge, setNudge] = useState<TodayNudge | null>(null);

  // 一句话提醒：挂载时拉一次，失败静默
  useEffect(() => {
    let cancelled = false;
    fetchTodayNudge().then((n) => {
      if (!cancelled && n) setNudge(n);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const today = useMemo(() => localDateStr(new Date().toISOString()), []);

  /** threadId → 今天的未完成待办；未来/过去日期不进入今天页 */
  const todosByThread = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.threadId || task.status !== 'todo' || task.date !== today) continue;
      const list = map.get(task.threadId);
      if (list) list.push(task);
      else map.set(task.threadId, [task]);
    }
    return map;
  }, [tasks, today]);

  /** 只展示今天有待办的 active 线程；明确排到其他日期的事项不进入今天页 */
  const sortedThreads = useMemo<Thread[]>(() => {
    const active = threads.filter((t) => t.status === 'active' && todosByThread.has(t.id));
    return active.sort((a, b) => {
      const ta = a.lastTouchedAt ? new Date(a.lastTouchedAt).getTime() : 0;
      const tb = b.lastTouchedAt ? new Date(b.lastTouchedAt).getTime() : 0;
      return ta - tb;
    });
  }, [threads, todosByThread]);

  /** 勾选 = 照顾：切 todo↔done；完成时写回线程 lastTouchedAt（行内立即出现正反馈） */
  const toggleTask = (threadId: string, task: Task) => {
    const becomingDone = task.status !== 'done';
    if (becomingDone) completeTask(task.id);
    else updateTaskStatus(task.id, 'todo');
    if (becomingDone) {
      void patchThread(threadId, { lastTouchedAt: new Date().toISOString() });
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="text-xs text-muted-foreground">
        你的线程
        <span className="ml-2 text-[11px] text-muted-foreground/70">
          最久没照顾的排在最前，勾掉一件待办就算照顾过它
        </span>
      </div>

      {sortedThreads.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        今天没有安排中的线程待办——其他日期的事项不会显示在这里。
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {sortedThreads.map((t) => {
            const meta = DOMAIN_META[t.domain] ?? DOMAIN_META.self;
            const touch = touchState(t.lastTouchedAt, today);
            const todos = todosByThread.get(t.id) ?? [];
            const expanded = expandedId === t.id;
            return (
              <li
                key={t.id}
                className="rounded-lg border border-border bg-background/40 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left"
                >
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform',
                      expanded && 'rotate-90',
                    )}
                    strokeWidth={1.8}
                  />
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px]',
                      DOMAIN_BADGE[t.domain] ?? DOMAIN_BADGE.self,
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {t.title}
                  </span>
                  {t.autoCreated && (
                    <span className="shrink-0 rounded-full border border-olive/40 bg-olive/10 px-1.5 py-0.5 font-data text-[9px] text-olive">
                      自动
                    </span>
                  )}
                  {todos.length > 0 && (
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-data text-[11px] text-muted-foreground">
                      {todos.length} 个待办
                    </span>
                  )}
                  {touch.kind === 'today' ? (
                    <span className="shrink-0 text-[11px] text-olive">今天已照顾 ✓</span>
                  ) : touch.kind === 'never' ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground/70">
                      还没照顾过
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {touch.days} 天没碰
                    </span>
                  )}
                </button>

                {expanded && (
                  <div className="border-t border-border/60 px-4 py-3">
                    {todos.length === 0 ? (
                      <p className="pl-6 text-xs text-muted-foreground/80">
                        这条线程当前没有待办任务。
                      </p>
                    ) : (
                      <ul className="space-y-1 pl-1.5">
                        {todos.map((task) => (
                          <li key={task.id}>
                            <button
                              type="button"
                              onClick={() => toggleTask(t.id, task)}
                              className="flex w-full items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent/50"
                            >
                              <span
                                className={cn(
                                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                                  'border-border text-transparent',
                                )}
                              >
                                <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[13px] leading-relaxed text-foreground/85">
                                  {task.title}
                                </span>
                                <span className="mt-0.5 block font-data text-[10px] text-muted-foreground/70">
                                  {taskDateLabel(task.date, today)} · {ENERGY_LABEL[task.energyCost]}
                                  {recurrenceLabel(task) && ` · ${recurrenceLabel(task)}`}
                                  {task.deferredTo && ` · 原计划顺延至 ${task.deferredTo}`}
                                </span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 一句话提醒：/api/today-nudge，失败静默不显示 */}
      {nudge && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-border/60 bg-background/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <MessageCircleHeart className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.8} />
          {nudge.text}
        </p>
      )}
    </section>
  );
}
