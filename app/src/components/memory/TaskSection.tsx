/**
 * TaskSection · 任务记录分区
 * ─────────────────────────────────────────────
 * 可操作的的任务记录：
 * 1. 顶部过滤 chips（全部 / 待办 / 已完成 / 已跳过，带计数）。
 * 2. 列表按线程分组（threadId → store.threads 解析标题 + 领域徽标），
 *    未挂线程的任务归入「未挂线程」组排最后；组内按日期倒序。
 * 3. 左侧圆圈可点击切换 待办↔已完成（store.updateTaskStatus），
 *    skipped 仅展示不参与切换；done 标题置灰加删除线。
 * 4. 每条显示：状态图标、标题、日期（MM-dd）、能耗小标记（低/中/高）。
 *
 * 性能约定：useLifeOS selector 只返回原始数组引用（s.tasks / s.threads），
 * 过滤 / 分组 / 排序全部在 useMemo 内完成，避免 selector 返回新数组导致无限重渲染。
 */
import { useMemo, useState } from 'react';
import { Circle, CheckCircle2, MinusCircle, Link2Off } from 'lucide-react';
import type { Task, Thread, ThreadDomain } from '@/types';
import { useLifeOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import { DOMAIN_META } from '@/components/threads/domain';

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────

type FilterKey = 'all' | 'todo' | 'done' | 'skipped';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待办' },
  { key: 'done', label: '已完成' },
  { key: 'skipped', label: '已跳过' },
];

/** 能耗小标记：低饱和暖调圆点 + 单字标签 */
const COST_META: Record<Task['energyCost'], { label: string; dotClass: string }> = {
  high: { label: '高', dotClass: 'bg-[#b08968]' },
  medium: { label: '中', dotClass: 'bg-brand' },
  low: { label: '低', dotClass: 'bg-olive' },
};

function recurrenceLabel(task: Task): string | null {
  const rule = task.recurrence;
  if (!rule) return null;
  if (rule.frequency === 'daily') return '每日';
  if (rule.frequency === 'monthly') return '每月';
  if (rule.weekdays?.length) return `每周 ${rule.weekdays.map((day) => ['日', '一', '二', '三', '四', '五', '六'][day]).join('、')}`;
  return '每周';
}

const UNTHREADED_KEY = '__unthreaded__';

interface TaskGroup {
  key: string;
  title: string;
  domain?: ThreadDomain;
  /** 组内最新任务日期，用于组间排序 */
  latestDate: string;
  items: Task[];
}

// ─────────────────────────────────────────────
// 单条任务行
// ─────────────────────────────────────────────

function TaskRow({ task }: { task: Task }) {
  const updateTaskStatus = useLifeOS((s) => s.updateTaskStatus);
  const completeTask = useLifeOS((s) => s.completeTask);
  const toggleable = task.status !== 'skipped';
  const done = task.status === 'done';

  const toggle = () => {
    if (!toggleable) return;
    if (done) updateTaskStatus(task.id, 'todo');
    else completeTask(task.id);
  };

  const cost = COST_META[task.energyCost];

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3.5 py-2.5">
      {/* 状态圆圈：todo↔done 可切换，skipped 仅展示 */}
      {toggleable ? (
        <button
          type="button"
          onClick={toggle}
          aria-label={done ? '标记为待办' : '标记为已完成'}
          title={done ? '标记为待办' : '标记为已完成'}
          className={cn(
            'shrink-0 rounded-full transition-colors',
            done ? 'text-olive' : 'text-muted-foreground/60 hover:text-brand',
          )}
        >
          {done ? (
            <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={1.8} />
          ) : (
            <Circle className="h-[18px] w-[18px]" strokeWidth={1.8} />
          )}
        </button>
      ) : (
        <span className="shrink-0 text-muted-foreground/50" title="已跳过">
          <MinusCircle className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </span>
      )}

      {/* 标题 */}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          done
            ? 'text-muted-foreground line-through decoration-muted-foreground/40'
            : task.status === 'skipped'
              ? 'text-muted-foreground/70'
              : 'text-foreground',
        )}
      >
        {task.title}
      </span>

      {/* 顺延信息（如有） */}
      {task.deferredTo && !done && (
        <span className="shrink-0 font-data text-[10px] text-muted-foreground/70">
          → {task.deferredTo}
        </span>
      )}

      {/* 日期 MM-dd */}
      <span className="shrink-0 font-data text-[10px] text-muted-foreground/70">
        {recurrenceLabel(task) ? `${recurrenceLabel(task)} · ` : ''}{task.date.slice(5)}
      </span>

      {/* 能耗小标记 */}
      <span className="flex shrink-0 items-center gap-1 font-data text-[10px] text-muted-foreground">
        <span className={cn('h-1.5 w-1.5 rounded-full', cost.dotClass)} />
        {cost.label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────
// 分区主体
// ─────────────────────────────────────────────

export default function TaskSection({ tasks }: { tasks: Task[] }) {
  // 只取原始引用，过滤/分组/排序全部放 useMemo
  const threads = useLifeOS((s) => s.threads);
  const [filter, setFilter] = useState<FilterKey>('all');

  // 各状态计数（基于全量任务，不随过滤变化）
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: tasks.length, todo: 0, done: 0, skipped: 0 };
    for (const t of tasks) c[t.status] += 1;
    return c;
  }, [tasks]);

  // 线程 id → Thread 映射
  const threadById = useMemo(() => {
    const m = new Map<string, Thread>();
    for (const t of threads) m.set(t.id, t);
    return m;
  }, [threads]);

  // 过滤 → 按线程分组（组内日期倒序，组间按最新日期倒序，未挂线程排最后）
  const groups = useMemo<TaskGroup[]>(() => {
    const visible = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

    const byThread = new Map<string, TaskGroup>();
    for (const t of visible) {
      const thread = t.threadId ? threadById.get(t.threadId) : undefined;
      const key = thread ? thread.id : UNTHREADED_KEY;
      let g = byThread.get(key);
      if (!g) {
        g = {
          key,
          title: thread ? thread.title : '未挂线程',
          domain: thread?.domain,
          latestDate: t.date,
          items: [],
        };
        byThread.set(key, g);
      }
      g.items.push(t);
      if (t.date > g.latestDate) g.latestDate = t.date;
    }

    const list = [...byThread.values()];
    for (const g of list) {
      g.items.sort((a, b) => b.date.localeCompare(a.date));
    }
    list.sort((a, b) => {
      if (a.key === UNTHREADED_KEY) return 1;
      if (b.key === UNTHREADED_KEY) return -1;
      return b.latestDate.localeCompare(a.latestDate);
    });
    return list;
  }, [tasks, filter, threadById]);

  if (tasks.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        还没有任何任务记录。每天的计划与执行都会在这里留痕。
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* 过滤 chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(({ key, label }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                active
                  ? 'border-brand/50 bg-brand/10 font-medium text-brand'
                  : 'border-border bg-background/40 text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              <span
                className={cn(
                  'font-data text-[10px]',
                  active ? 'text-brand/80' : 'text-muted-foreground/60',
                )}
              >
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* 分组列表 */}
      {groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          当前过滤条件下没有任务。
        </p>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => {
            const meta = g.domain ? DOMAIN_META[g.domain] : undefined;
            const DomainIcon = meta?.icon;
            return (
              <section key={g.key}>
                {/* 组头：线程名 + 领域小徽标 + 计数 */}
                <div className="mb-2.5 flex items-center gap-2">
                  {g.key === UNTHREADED_KEY ? (
                    <Link2Off className="h-3.5 w-3.5 text-muted-foreground/60" strokeWidth={1.8} />
                  ) : null}
                  <span className="text-sm font-medium text-foreground">{g.title}</span>
                  {meta && DomainIcon && (
                    <span className="flex items-center gap-1 rounded-full border border-border bg-background/40 px-1.5 py-0.5 font-data text-[10px]">
                      <DomainIcon className={cn('h-2.5 w-2.5', meta.textClass)} strokeWidth={2} />
                      <span className={meta.textClass}>{meta.label}</span>
                    </span>
                  )}
                  <span className="font-data text-[10px] text-muted-foreground">
                    {g.items.length} 项
                  </span>
                </div>
                <div className="space-y-1.5">
                  {g.items.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
