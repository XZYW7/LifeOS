/**
 * KnowledgeSection · 知识分区
 * ─────────────────────────────────────────────
 * KnowledgeItem 卡片列表：标题 + type 徽标 + 内容摘要（前 120 字），
 * 点击卡片展开 / 收起全文（whitespace-pre-wrap 保留换行）。
 * 搜索框按标题与内容过滤。
 * 条目带 threadId 时，从 store 的 threads 查标题，在卡片上显示线程小徽标；
 * selector 只返回 store 原始引用，id→标题映射在 useMemo 中派生。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useLifeOS } from '@/lib/store';
import type { KnowledgeItem } from '@/types';
import { cn } from '@/lib/utils';

const TYPE_META: Record<KnowledgeItem['type'], { label: string; className: string }> = {
  note: { label: '笔记', className: 'border-brand/40 bg-brand/10 text-brand' },
  method: { label: '方法', className: 'border-brand/40 bg-brand/10 text-brand' },
  experience: { label: '经验', className: 'border-olive/40 bg-olive/15 text-olive' },
  recipe: { label: '配方', className: 'border-olive/40 bg-olive/15 text-olive' },
  guide: { label: '攻略', className: 'border-brand/40 bg-brand/10 text-brand' },
  resource: { label: '资源', className: 'border-border bg-muted text-muted-foreground' },
  paper: { label: '论文', className: 'border-olive/40 bg-olive/15 text-olive' },
  idea: { label: '想法', className: 'border-brand/40 bg-brand/10 text-brand' },
  'learning-log': { label: '学习日志', className: 'border-border bg-muted text-muted-foreground' },
};

const SUMMARY_LEN = 120;

function KnowledgeCard({
  item,
  threadTitle,
  expanded,
  onToggle,
}: {
  item: KnowledgeItem;
  threadTitle?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = TYPE_META[item.type] ?? TYPE_META.note;
  const needsTruncate = item.content.length > SUMMARY_LEN;
  const summary = needsTruncate ? `${item.content.slice(0, SUMMARY_LEN)}…` : item.content;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full rounded-md border border-border bg-card px-4 py-3.5 text-left transition-colors hover:border-brand/30"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {item.title}
        </span>
        {threadTitle && (
          <span className="shrink-0 max-w-32 truncate rounded-full border border-olive/40 bg-olive/10 px-1.5 py-0.5 font-data text-[9px] text-olive">
            {threadTitle}
          </span>
        )}
        <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 font-data text-[10px]', meta.className)}>
          {meta.label}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform', expanded && 'rotate-180')}
        />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {expanded ? '' : summary}
      </p>
      {expanded && (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
          {item.content}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="font-data text-[10px] text-muted-foreground/60">
          {item.createdAt.slice(0, 10)}
        </span>
        {needsTruncate && !expanded && (
          <span className="text-[10px] text-brand/80">展开全文</span>
        )}
      </div>
    </button>
  );
}

export default function KnowledgeSection({ knowledge }: { knowledge: KnowledgeItem[] }) {
  const [query, setQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  // 原始引用（store 内稳定数组），无新对象 → 无需 useShallow
  const threads = useLifeOS((s) => s.threads);

  // 线程 id → 标题映射，useMemo 派生，供卡片徽标查询
  const threadTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of threads) map.set(t.id, t.title);
    return map;
  }, [threads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...knowledge].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!q) return list;
    return list.filter(
      (k) => k.title.toLowerCase().includes(q) || k.content.toLowerCase().includes(q),
    );
  }, [knowledge, query]);

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索知识标题或内容…"
          className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-brand/40"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {knowledge.length === 0
            ? '还没有任何知识条目。笔记、论文摘录与学习日志会在这里归档。'
            : '没有匹配的知识条目。'}
        </p>
      ) : (
        <div className="mt-5 space-y-2.5">
          {filtered.map((k) => (
            <KnowledgeCard
              key={k.id}
              item={k}
              threadTitle={k.threadId ? threadTitleById.get(k.threadId) : undefined}
              expanded={expandedIds.has(k.id)}
              onToggle={() => toggle(k.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
