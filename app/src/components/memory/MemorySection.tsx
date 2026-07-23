/**
 * MemorySection · 记忆分区
 * ─────────────────────────────────────────────
 * 按 kind 分组（事实 / 模式 / 洞察，沿用 MemoryPanel 的 KIND 徽标风格），
 * 默认只显示 active 且未 superseded 的条目，「显示已失效」开关可展开存档。
 * 搜索框按内容过滤；失效条目以删除线 + 「已失效」徽标弱化呈现。
 */
import { useMemo, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Bookmark,
  Lightbulb,
  Repeat,
  Search,
} from 'lucide-react';
import type { Confidence, MemoryEntry, MemoryKind } from '@/types';
import { cn } from '@/lib/utils';
import ProfileCard from '@/components/memory/ProfileCard';

const KIND_META: Record<MemoryKind, { label: string; icon: typeof Bookmark; hint: string }> = {
  fact: { label: '事实', icon: Bookmark, hint: '你告诉过我、且仍然成立的事' },
  pattern: { label: '模式', icon: Repeat, hint: '从历史记录里观察到的规律' },
  insight: { label: '洞察', icon: Lightbulb, hint: '基于数据做出的推断' },
};

const KIND_ORDER: MemoryKind[] = ['fact', 'pattern', 'insight'];

type SortDir = 'newest' | 'oldest';

/** 排序依据：精确创建/确认时间优先，旧数据退回日期字段 */
function sortKeyOf(m: MemoryEntry): string {
  return m.createdAt || m.lastConfirmedAt || m.firstSeenAt || '';
}

/** ISO 日期 → MM-dd（无效输入时原样截断，避免抛错） */
function formatMMdd(iso: string): string {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : iso.slice(5, 10);
}

const CONF_META: Record<Confidence, { label: string; className: string }> = {
  high: { label: '高置信', className: 'border-olive/40 bg-olive/15 text-olive' },
  medium: { label: '中置信', className: 'border-brand/40 bg-brand/10 text-brand' },
  low: { label: '低置信', className: 'border-border bg-muted text-muted-foreground' },
};

function MemoryRow({ entry, stale }: { entry: MemoryEntry; stale: boolean }) {
  const conf = CONF_META[entry.confidence];
  const key = sortKeyOf(entry);
  return (
    <div className={cn('rounded-md border border-border bg-card px-3 py-2.5', stale && 'opacity-60')}>
      <p className={cn('text-sm leading-relaxed text-foreground', stale && 'line-through decoration-muted-foreground/50')}>
        {entry.content}
      </p>
      <div className="mt-2 flex items-center gap-2">
        {key && (
          <span className="font-data text-[10px] text-muted-foreground/70">
            {(entry.confirmCount ?? 1) > 1 ? '确认于' : '初见于'} {formatMMdd(key)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {(entry.confirmCount ?? 0) > 1 && (
            <span className="rounded-full border border-brand/40 bg-brand/10 px-1.5 py-0.5 font-data text-[10px] text-brand">
              确认×{entry.confirmCount}
            </span>
          )}
          {stale && (
            <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 font-data text-[10px] text-muted-foreground">
              已失效
            </span>
          )}
          {entry.kind === 'insight' && (
            <span className={cn('rounded-full border px-1.5 py-0.5 font-data text-[10px]', conf.className)}>
              {conf.label}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export default function MemorySection({ memories }: { memories: MemoryEntry[] }) {
  const [showStale, setShowStale] = useState(false);
  const [query, setQuery] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('newest');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sortDir === 'newest' ? -1 : 1;
    return memories
      .filter((m) => {
        if (!showStale && (!m.active || m.superseded)) return false;
        if (q && !m.content.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const ka = sortKeyOf(a);
        const kb = sortKeyOf(b);
        if (ka === kb) return 0;
        return (ka > kb ? 1 : -1) * dir;
      });
  }, [memories, showStale, query, sortDir]);

  const staleCount = useMemo(
    () => memories.filter((m) => !m.active || m.superseded).length,
    [memories],
  );

  return (
    <div>
      {/* 用户画像卡：server 下发 profile 时展示，无画像不渲染 */}
      <ProfileCard className="mb-6" />

      {/* 工具行：搜索 + 显示已失效开关（移动端允许换行） */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索记忆内容…"
            className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-brand/40"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowStale((v) => !v)}
          aria-pressed={showStale}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors',
            showStale
              ? 'border-brand/40 bg-brand/10 text-brand'
              : 'border-border bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          <span
            className={cn(
              'relative h-3.5 w-6 rounded-full transition-colors',
              showStale ? 'bg-brand' : 'bg-muted-foreground/30',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-2.5 w-2.5 rounded-full bg-card transition-all',
                showStale ? 'left-3' : 'left-0.5',
              )}
            />
          </span>
          显示已失效
          {staleCount > 0 && <span className="font-data text-[10px]">{staleCount}</span>}
        </button>
        {/* 排序切换：最新优先 / 最早优先 */}
        <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-border bg-card">
          {(
            [
              { dir: 'newest' as SortDir, label: '最新优先', Icon: ArrowDownWideNarrow },
              { dir: 'oldest' as SortDir, label: '最早优先', Icon: ArrowUpNarrowWide },
            ]
          ).map(({ dir, label, Icon }) => (
            <button
              key={dir}
              type="button"
              onClick={() => setSortDir(dir)}
              aria-pressed={sortDir === dir}
              className={cn(
                'flex items-center gap-1 px-2.5 py-2 text-[11px] transition-colors',
                sortDir === dir
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3 w-3" strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 分组列表 */}
      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {memories.length === 0
            ? '还没有任何记忆。随手记、对话与历史导入都会在这里沉淀。'
            : '没有匹配的记忆。'}
        </p>
      ) : (
        <div className="mt-6 space-y-7">
          {KIND_ORDER.map((kind) => {
            const meta = KIND_META[kind];
            const items = filtered.filter((m) => m.kind === kind);
            if (items.length === 0) return null;
            const Icon = meta.icon;
            return (
              <section key={kind}>
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
                  <span className="text-sm font-medium text-foreground">{meta.label}</span>
                  <span className="font-data text-xs text-muted-foreground">{items.length}</span>
                </div>
                <p className="mb-3 mt-0.5 text-[11px] text-muted-foreground/70">{meta.hint}</p>
                <div className="space-y-2">
                  {items.map((m) => (
                    <MemoryRow key={m.id} entry={m} stale={!m.active || m.superseded} />
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
