/**
 * Timeline 页 · 单个 LifeVersion 节点（Git commit 风格）
 * 头部：版本名 + 短 hash + 日期；展开后呈现三段式正文：
 * happened（发生了什么）/ gained（获得了什么）/ released（放弃了什么）。
 * released 用删除线与低饱和呈现，呼应"放弃也是前进"。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, GitCommitHorizontal, Package } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLifeOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { LifeVersion, MemoryEntry } from '@/types';

/** 由 id 派生稳定的 7 位短 hash（模拟 git short hash，仅作展示） */
export function shortHash(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0').slice(0, 7);
}

/** "2026-06" → "v2026.06"；自定义命名（如 gap-month-v1）原样展示 */
export function displayVersion(v: string): string {
  return /^\d{4}-\d{2}$/.test(v) ? `v${v.replace('-', '.')}` : v;
}

type Tone = 'neutral' | 'gain' | 'release';

const SECTION_META: Record<Tone, { title: string; prefix: string }> = {
  neutral: { title: '发生了什么', prefix: '·' },
  gain: { title: '获得了什么', prefix: '+' },
  release: { title: '放弃了什么', prefix: '−' },
};

function DiffSection({ tone, items }: { tone: Tone; items: string[] }) {
  if (items.length === 0) return null;
  const meta = SECTION_META[tone];
  return (
    <section>
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground">{meta.title}</h4>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-baseline gap-2 text-sm leading-relaxed">
            <span
              className={cn(
                'font-data shrink-0',
                tone === 'gain' && 'text-olive',
                tone === 'release' && 'text-muted-foreground/70',
                tone === 'neutral' && 'text-brand-dim',
              )}
            >
              {meta.prefix}
            </span>
            <span
              className={cn(
                tone === 'release'
                  ? 'text-muted-foreground/80 line-through decoration-muted-foreground/50'
                  : 'text-foreground/90',
              )}
            >
              {item}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Props {
  version: LifeVersion;
  expanded: boolean;
  isLatest: boolean;
  onToggle: () => void;
}

export default function VersionNode({ version, expanded, isLatest, onToggle }: Props) {
  const stats = version.statsSnapshot;
  // Zustand：选择器只取原始引用，按 id 解析记忆的派生计算交给 useMemo
  const memories = useLifeOS((s) => s.memories);
  const [packedOpen, setPackedOpen] = useState(false);

  const packedCount = version.memoryIds?.length ?? 0;

  const packed = useMemo<MemoryEntry[]>(() => {
    if (!version.memoryIds || version.memoryIds.length === 0) return [];
    const byId = new Map(memories.map((m) => [m.id, m]));
    // 查不到的记忆（已清理/未同步）跳过
    return version.memoryIds
      .map((id) => byId.get(id))
      .filter((m): m is MemoryEntry => m !== undefined);
  }, [memories, version.memoryIds]);

  return (
    <li className="relative pb-8 pl-10 last:pb-0">
      {/* commit 节点 */}
      <span
        className={cn(
          'absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border',
          isLatest
            ? 'border-brand bg-brand/15 text-brand'
            : 'border-border bg-card text-muted-foreground',
        )}
      >
        <GitCommitHorizontal className="h-3 w-3" strokeWidth={2} />
      </span>

      {/* commit 头：版本名 + hash + 日期 */}
      <button type="button" onClick={onToggle} className="group w-full text-left">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-data text-base font-semibold text-foreground transition-colors group-hover:text-brand">
            {displayVersion(version.version)}
          </span>
          <span className="font-data text-xs text-brand-dim">{shortHash(version.id)}</span>
          <span className="font-data text-xs text-muted-foreground">{version.date}</span>
          {isLatest && (
            <span className="rounded border border-brand/40 bg-brand/10 px-1.5 py-px font-data text-[10px] tracking-wider text-brand">
              HEAD
            </span>
          )}
          <span className="ml-auto text-muted-foreground/60 transition-colors group-hover:text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        </div>
        {!expanded && version.summary && (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{version.summary}</p>
        )}
      </button>

      {/* 展开正文 */}
      {expanded && (
        <Card className="mt-3 space-y-5 border-border bg-card p-5">
          {version.period && (
            <div className="font-data text-xs text-muted-foreground">
              周期 {version.period.from} → {version.period.to}
            </div>
          )}

          <DiffSection tone="neutral" items={version.happened} />
          <DiffSection tone="gain" items={version.gained} />
          <DiffSection tone="release" items={version.released} />

          {/* 本次提交打包的长期记忆 */}
          {packedCount > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setPackedOpen((v) => !v)}
                className="group flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:text-brand"
              >
                <Package className="h-3.5 w-3.5 text-brand-dim" />
                打包 {packedCount} 条记忆
                <span className="text-muted-foreground/60 transition-colors group-hover:text-muted-foreground">
                  {packedOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </span>
              </button>
              {packedOpen && (
                <ul className="mt-2 space-y-1.5">
                  {packed.map((m) => (
                    <li key={m.id} className="flex items-baseline gap-2 text-sm leading-relaxed">
                      <span className="shrink-0 font-data text-brand-dim">·</span>
                      <span className="text-foreground/90">{m.content}</span>
                    </li>
                  ))}
                  {packed.length === 0 && (
                    <li className="text-xs text-muted-foreground/70">
                      记忆内容暂不可查（可能已被清理或尚未同步）。
                    </li>
                  )}
                </ul>
              )}
            </section>
          )}

          {version.summary && (
            <p className="border-l-2 border-brand/40 pl-3 text-sm leading-relaxed text-muted-foreground">
              {version.summary}
            </p>
          )}

          {stats && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 font-data text-xs text-muted-foreground">
              <span>活跃天数 {stats.activeDays}</span>
              {stats.dominantEmotionTag && <span>主导情绪 {stats.dominantEmotionTag}</span>}
              <span>模式切换 {stats.modeChanges} 次</span>
            </div>
          )}
        </Card>
      )}
    </li>
  );
}
