import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Repeat, RotateCcw } from 'lucide-react';
import type { Task, Thread } from '@/types';
import { nextRecurringDate } from '@/lib/store';
import { cn } from '@/lib/utils';
import { DOMAIN_META } from '@/components/threads/domain';

const HORIZON_DAYS = 14;

function localDateStr(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: string, amount: number): string {
  const next = parseDate(date);
  next.setDate(next.getDate() + amount);
  return localDateStr(next);
}

function weekdayLabel(date: string): string {
  return ['日', '一', '二', '三', '四', '五', '六'][parseDate(date).getDay()];
}

function recurrenceLabel(task: Task): string | null {
  const rule = task.recurrence;
  if (!rule) return null;
  if (rule.frequency === 'daily') return '每日';
  if (rule.frequency === 'monthly') return '每月';
  if (rule.weekdays?.length) return `每周 ${rule.weekdays.map((day) => ['日', '一', '二', '三', '四', '五', '六'][day]).join('、')}`;
  return '每周';
}

interface Occurrence {
  task: Task;
  date: string;
  projected: boolean;
}

function projectOccurrences(task: Task, from: string, to: string): Occurrence[] {
  if (task.date < from || task.date > to) return [];
  const occurrences: Occurrence[] = [{ task, date: task.date, projected: false }];
  if (task.kind !== 'recurring' || !task.recurrence) return occurrences;

  let cursor = task;
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const nextDate = nextRecurringDate(cursor);
    if (nextDate > to) break;
    occurrences.push({ task, date: nextDate, projected: true });
    cursor = { ...cursor, date: nextDate };
  }
  return occurrences;
}

function TaskChip({ occurrence, threadById }: { occurrence: Occurrence; threadById: Map<string, Thread> }) {
  const thread = occurrence.task.threadId ? threadById.get(occurrence.task.threadId) : undefined;
  const meta = thread ? DOMAIN_META[thread.domain] : undefined;
  return (
    <div
      title={`${occurrence.task.title}${thread ? ` · ${thread.title}` : ''}`}
      className={cn(
        'rounded border px-2 py-1.5 text-[11px] leading-snug',
        occurrence.projected ? 'border-dashed border-border bg-background/35 text-muted-foreground' : 'border-border bg-card text-foreground/85',
      )}
    >
      <div className="line-clamp-2">{occurrence.task.title}</div>
      <div className="mt-1 flex items-center gap-1 font-data text-[9px] text-muted-foreground/70">
        {meta && <span className={meta.textClass}>{meta.label}</span>}
        {occurrence.projected && <span>例行</span>}
      </div>
    </div>
  );
}

export default function TaskTimeline({ tasks, threads }: { tasks: Task[]; threads: Thread[] }) {
  const today = useMemo(() => localDateStr(), []);
  const [start, setStart] = useState(today);
  const end = addDays(start, HORIZON_DAYS - 1);
  const threadById = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);
  const todos = useMemo(() => tasks.filter((task) => task.status === 'todo'), [tasks]);
  const dates = useMemo(() => Array.from({ length: HORIZON_DAYS }, (_, index) => addDays(start, index)), [start]);

  const overdue = useMemo(
    () => todos.filter((task) => task.date < today).sort((a, b) => a.date.localeCompare(b.date)),
    [todos, today],
  );
  const recurring = useMemo(
    () => todos.filter((task) => task.kind === 'recurring' && task.recurrence),
    [todos],
  );
  const distant = useMemo(
    () => todos.filter((task) => task.date > end).sort((a, b) => a.date.localeCompare(b.date)),
    [todos, end],
  );
  const occurrencesByDate = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const task of todos) {
      for (const occurrence of projectOccurrences(task, start, end)) {
        const list = map.get(occurrence.date) ?? [];
        list.push(occurrence);
        map.set(occurrence.date, list);
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.task.energyCost.localeCompare(b.task.energyCost));
    return map;
  }, [todos, start, end]);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">未来负担</p>
          <p className="mt-1 text-xs text-muted-foreground">不把长期事项伪装成日期；只展示已承诺的执行日与固定节律。</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setStart(addDays(start, -7))} aria-label="查看前一周" className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setStart(today)} disabled={start === today} className="rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">
            <RotateCcw className="mr-1 inline h-3 w-3" />今天
          </button>
          <button type="button" onClick={() => setStart(addDays(start, 7))} aria-label="查看后一周" className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {overdue.length > 0 && (
        <section className="rounded-lg border border-amber-500/25 bg-amber-500/[0.035] px-4 py-3.5">
          <header className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />逾期 · {overdue.length}
          </header>
          <div className="mt-2 flex flex-wrap gap-2">
            {overdue.map((task) => (
              <div key={task.id} className="rounded border border-amber-500/20 bg-background/45 px-2 py-1.5 text-xs text-foreground/80">
                <span className="mr-1.5 font-data text-[10px] text-amber-700/80 dark:text-amber-400/80">{task.date.slice(5)}</span>
                {task.title}
              </div>
            ))}
          </div>
        </section>
      )}

      {recurring.length > 0 && (
        <section>
          <header className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Repeat className="h-3.5 w-3.5" />固定节律
          </header>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {recurring.map((task) => {
              const thread = task.threadId ? threadById.get(task.threadId) : undefined;
              return (
                <div key={task.id} className="rounded-md border border-border bg-card px-3 py-2.5">
                  <div className="text-sm text-foreground">{task.title}</div>
                  <div className="mt-1 font-data text-[10px] text-muted-foreground/70">
                    {recurrenceLabel(task)} · 下次 {task.date}
                    {thread && ` · ${thread.title}`}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <header className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>未来 14 天</span>
          <span className="font-data">{start.slice(5)} — {end.slice(5)}</span>
        </header>
        <div className="mt-2 overflow-x-auto pb-2">
          <div className="grid min-w-[1260px] grid-cols-14 gap-2">
            {dates.map((date) => {
              const occurrences = occurrencesByDate.get(date) ?? [];
              const isToday = date === today;
              return (
                <div key={date} className={cn('min-h-40 rounded-lg border p-2', isToday ? 'border-brand/45 bg-brand/[0.045]' : 'border-border bg-background/25')}>
                  <div className={cn('mb-2 border-b pb-1.5 font-data text-[10px]', isToday ? 'border-brand/25 text-brand' : 'border-border/70 text-muted-foreground')}>
                    <div>{date.slice(5)}</div>
                    <div className="mt-0.5 text-[9px] opacity-70">周{weekdayLabel(date)}{isToday ? ' · 今天' : ''}</div>
                  </div>
                  <div className="space-y-1.5">
                    {occurrences.map((occurrence, index) => <TaskChip key={`${occurrence.task.id}-${occurrence.date}-${index}`} occurrence={occurrence} threadById={threadById} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {distant.length > 0 && (
        <section>
          <header className="text-xs font-medium text-muted-foreground">远期 · {distant.length}</header>
          <div className="mt-2 space-y-1.5">
            {distant.map((task) => (
              <div key={task.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
                <span className="font-data text-[10px] text-muted-foreground/70">{task.date}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/85">{task.title}</span>
                {recurrenceLabel(task) && <span className="text-[10px] text-muted-foreground">{recurrenceLabel(task)}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
