/**
 * ThreadLinkage · 线程卡片的「联动」区（可展开/收起，默认收起）
 * ─────────────────────────────────────────────
 * 解决「线程和记忆没有联动」的感知问题：把挂到这条线程上的
 * 任务 / 记忆 / 知识直接在卡片里列出来，全部来自本地 store，不调新 API。
 *
 * 关联规则：
 * - 任务：tasks 中 threadId === thread.id（Task 类型暂未声明 threadId，
 *   这里做兼容扩展，字段落地后自动生效），todo 在前，done/skipped 置灰划线。
 * - 记忆：仅 active && !superseded 且 sourceRefs 显式含 thread.id，最多 5 条。
 * - 知识：标题或内容包含同一关键词，最多 3 条。
 *
 * 性能：selector 只取 store 原始数组引用（稳定，无新对象），
 * 过滤/分组在 useMemo 中完成 —— 与 ThreadsPage 同款模式，无需 useShallow。
 */
import { useMemo, useState } from 'react';
import { BookOpen, Brain, CheckCircle2, ChevronDown, ChevronRight, Circle, ListTodo } from 'lucide-react';
import { useLifeOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { KnowledgeItem, MemoryEntry, Task, Thread } from '@/types';

/** Task 类型尚未声明 threadId（任务侧后续补齐），此处兼容扩展 */
type TaskWithThread = Task & { threadId?: string };

const MEMORY_KIND_LABEL: Record<MemoryEntry['kind'], string> = {
  fact: '事实',
  pattern: '模式',
  insight: '洞察',
};

const KNOWLEDGE_TYPE_LABEL: Record<KnowledgeItem['type'], string> = {
  note: '笔记',
  method: '方法',
  experience: '经验',
  recipe: '配方',
  guide: '攻略',
  resource: '资源',
  paper: '论文',
  idea: '想法',
  'learning-log': '学习日志',
};

const MAX_MEMORIES = 5;
const MAX_KNOWLEDGE = 3;

const ENERGY_LABEL: Record<Task['energyCost'], string> = {
  low: '低能耗',
  medium: '中能耗',
  high: '高能耗',
};

const STATUS_LABEL: Record<Task['status'], string> = {
  todo: '待办',
  done: '已完成',
  skipped: '已跳过',
};

function recurrenceLabel(task: Task): string | null {
  const rule = task.recurrence;
  if (!rule) return null;
  if (rule.frequency === 'daily') return '每日';
  if (rule.frequency === 'monthly') return '每月';
  if (rule.weekdays?.length) return `每周 ${rule.weekdays.map((day) => ['日', '一', '二', '三', '四', '五', '六'][day]).join('、')}`;
  return '每周';
}

/** 提取线程标题核心词：按「：」/「:」切分取较长片段，长度 <2 视为无效 */
function coreKeyword(title: string): string | null {
  const parts = title
    .split(/[：:]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const longest = parts.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.length >= 2 ? longest : null;
}

interface LinkedData {
  tasks: TaskWithThread[];
  memories: MemoryEntry[];
  knowledge: KnowledgeItem[];
}

export default function ThreadLinkage({ thread }: { thread: Thread }) {
  const [open, setOpen] = useState(false);

  // 原始引用（store 内稳定数组），无新对象 → 无需 useShallow
  const tasks = useLifeOS((s) => s.tasks);
  const memories = useLifeOS((s) => s.memories);
  const knowledge = useLifeOS((s) => s.knowledge);

  const linked = useMemo<LinkedData>(() => {
    const keyword = coreKeyword(thread.title);

    // ── 任务：threadId 直连，todo 在前，done/skipped 在后 ──
    const statusOrder: Record<Task['status'], number> = { todo: 0, done: 1, skipped: 2 };
    const linkedTasks = (tasks as TaskWithThread[])
      .filter((t) => t.threadId === thread.id)
      .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    // ── 记忆：只认显式关联；文本提及某线程不等于属于该线程 ──
    const linkedMemories = memories
      .filter((m) => m.active && !m.superseded && m.sourceRefs.includes(thread.id))
      .slice(-MAX_MEMORIES);

    // ── 知识：标题或内容命中关键词，最多 3 条 ──
    const linkedKnowledge =
      keyword === null
        ? []
        : knowledge
            .filter((k) => k.title.includes(keyword) || k.content.includes(keyword))
            .slice(0, MAX_KNOWLEDGE);

    return { tasks: linkedTasks, memories: linkedMemories, knowledge: linkedKnowledge };
  }, [tasks, memories, knowledge, thread.id, thread.title]);

  const total = linked.tasks.length + linked.memories.length + linked.knowledge.length;

  const badgeParts: string[] = [];
  if (linked.tasks.length > 0) badgeParts.push(`${linked.tasks.length} 任务`);
  if (linked.memories.length > 0) badgeParts.push(`${linked.memories.length} 记忆`);
  if (linked.knowledge.length > 0) badgeParts.push(`${linked.knowledge.length} 知识`);

  const groupLabel = 'text-[10px] text-muted-foreground/70';

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
        )}
        联动
        {total > 0 && (
          <span className="rounded-full border border-border bg-background/60 px-1.5 py-0.5 font-data text-[10px] text-muted-foreground">
            {badgeParts.join(' · ')}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 rounded-md border border-border/60 bg-background/40 px-3 py-2.5">
          {total === 0 ? (
            <p className="text-xs text-muted-foreground/70">
              还没有关联记录——随手记或对话里提到它，系统会自动挂上来。
            </p>
          ) : (
            <div className="space-y-3">
              {linked.tasks.length > 0 && (
                <section>
                  <header className="flex items-center gap-1.5">
                    <ListTodo className="h-3 w-3 text-muted-foreground/70" strokeWidth={1.8} />
                    <span className={groupLabel}>任务 · {linked.tasks.length}</span>
                  </header>
                  <ul className="mt-1 space-y-1">
                    {linked.tasks.map((t) => {
                      const done = t.status !== 'todo';
                      return (
                        <li key={t.id} className="flex items-center gap-1.5 text-xs">
                          {done ? (
                            <CheckCircle2
                              className="h-3 w-3 shrink-0 text-muted-foreground/50"
                              strokeWidth={1.8}
                            />
                          ) : (
                            <Circle
                              className="h-3 w-3 shrink-0 text-muted-foreground/70"
                              strokeWidth={1.8}
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block truncate',
                                done
                                  ? 'text-muted-foreground/60 line-through'
                                  : 'text-foreground/80',
                              )}
                            >
                              {t.title}
                            </span>
                            <span className="mt-0.5 block font-data text-[10px] text-muted-foreground/60">
                              执行日 {t.date} · {ENERGY_LABEL[t.energyCost]} · {STATUS_LABEL[t.status]}
                              {recurrenceLabel(t) && ` · ${recurrenceLabel(t)}`}
                              {t.deferredTo && ` · 顺延至 ${t.deferredTo}`}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {linked.memories.length > 0 && (
                <section>
                  <header className="flex items-center gap-1.5">
                    <Brain className="h-3 w-3 text-muted-foreground/70" strokeWidth={1.8} />
                    <span className={groupLabel}>记忆 · {linked.memories.length}</span>
                  </header>
                  <ul className="mt-1 space-y-1">
                    {linked.memories.map((m) => (
                      <li key={m.id} className="flex items-baseline gap-1.5 text-xs">
                        <span className="shrink-0 rounded border border-border/60 px-1 text-[9px] text-muted-foreground/60">
                          {MEMORY_KIND_LABEL[m.kind]}
                        </span>
                        <span className="line-clamp-2 leading-relaxed text-foreground/75">
                          {m.content}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {linked.knowledge.length > 0 && (
                <section>
                  <header className="flex items-center gap-1.5">
                    <BookOpen className="h-3 w-3 text-muted-foreground/70" strokeWidth={1.8} />
                    <span className={groupLabel}>知识 · {linked.knowledge.length}</span>
                  </header>
                  <ul className="mt-1 space-y-1">
                    {linked.knowledge.map((k) => (
                      <li key={k.id} className="flex items-baseline gap-1.5 text-xs">
                        <span className="shrink-0 rounded border border-border/60 px-1 text-[9px] text-muted-foreground/60">
                          {KNOWLEDGE_TYPE_LABEL[k.type]}
                        </span>
                        <span className="truncate text-foreground/75">{k.title}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
