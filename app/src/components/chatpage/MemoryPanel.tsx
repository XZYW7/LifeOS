/**
 * ChatPage 侧栏：Agent 长期记忆摘要。
 * 按 kind 分组：事实 / 模式 / 洞察（洞察带置信度徽标）。
 */
import { useMemo } from 'react';
import { Bookmark, Brain, Lightbulb, Repeat } from 'lucide-react';
import type { Confidence, MemoryEntry, MemoryKind } from '@/types';
import { useLifeOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import ProfileCard from '@/components/memory/ProfileCard';

const KIND_META: Record<MemoryKind, { label: string; icon: typeof Bookmark; hint: string }> = {
  fact: { label: '事实', icon: Bookmark, hint: '你告诉过我、且仍然成立的事' },
  pattern: { label: '模式', icon: Repeat, hint: '从历史记录里观察到的规律' },
  insight: { label: '洞察', icon: Lightbulb, hint: '我基于数据做出的推断' },
};

const KIND_ORDER: MemoryKind[] = ['fact', 'pattern', 'insight'];

const CONF_META: Record<Confidence, { label: string; className: string }> = {
  high: { label: '高置信', className: 'border-olive/40 bg-olive/15 text-olive' },
  medium: { label: '中置信', className: 'border-brand/40 bg-brand/10 text-brand' },
  low: { label: '低置信', className: 'border-border bg-muted text-muted-foreground' },
};

function MemoryCard({ entry }: { entry: MemoryEntry }) {
  const conf = CONF_META[entry.confidence];
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <p className="text-xs leading-relaxed text-foreground">{entry.content}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-data text-[10px] text-muted-foreground/70">
          确认于 {entry.lastConfirmedAt.slice(0, 10)}
        </span>
        {entry.kind === 'insight' && (
          <span
            className={cn(
              'rounded-full border px-1.5 py-0.5 font-data text-[10px]',
              conf.className,
            )}
          >
            {conf.label}
          </span>
        )}
      </div>
    </div>
  );
}

export default function MemoryPanel() {
  const memories = useLifeOS((s) => s.memories);
  const active = useMemo(
    () => memories.filter((m) => m.active && !m.superseded),
    [memories],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-5">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-brand" strokeWidth={1.8} />
          <h2 className="text-sm font-semibold text-foreground">Agent 长期记忆</h2>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          每次回复前，我都会读取这些记忆。被推翻的判断会标记存档，不会悄悄删除。
        </p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* 用户画像卡：server 下发 profile 时展示，无画像不渲染 */}
        <ProfileCard />
        {KIND_ORDER.map((kind) => {
          const meta = KIND_META[kind];
          const items = active.filter((m) => m.kind === kind);
          const Icon = meta.icon;
          return (
            <section key={kind}>
              <div className="mb-1 flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
                <span className="text-xs font-medium text-foreground">{meta.label}</span>
                <span className="font-data text-[10px] text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <p className="mb-2 text-[10px] text-muted-foreground/70">{meta.hint}</p>
              {items.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/50">暂无记录</p>
              ) : (
                <div className="space-y-2">
                  {items.map((m) => (
                    <MemoryCard key={m.id} entry={m} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
