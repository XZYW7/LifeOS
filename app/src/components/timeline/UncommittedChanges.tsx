/**
 * Timeline 页 · "未提交变更"区（真暂存区）
 * 口径：active 记忆里 versionId 为空，或 versionId 对应版本的 createdAt 早于
 * 该记忆 lastConfirmedAt（提交后又被重新确认 = 新变更）。
 * 全部提交完时显示「全部已提交 ✓」正反馈，不隐藏区块。
 */
import { useMemo } from 'react';
import { Check, CircleDashed } from 'lucide-react';
import { useLifeOS, getActiveMemories } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import type { Confidence, MemoryKind } from '@/types';

const KIND_LABEL: Record<MemoryKind, string> = {
  fact: '事实',
  pattern: '模式',
  insight: '洞察',
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

const KIND_STYLE: Record<MemoryKind, string> = {
  fact: 'border-border text-muted-foreground',
  pattern: 'border-olive/50 text-olive',
  insight: 'border-brand/50 text-brand',
};

export default function UncommittedChanges() {
  // Zustand：选择器只取原始引用，派生计算交给 useMemo
  const memories = useLifeOS(useShallow(getActiveMemories));
  const lifeVersions = useLifeOS((s) => s.lifeVersions);

  const uncommitted = useMemo(() => {
    const versionCreatedAt = new Map(lifeVersions.map((v) => [v.id, v.createdAt]));
    return memories.filter((m) => {
      if (!m.versionId) return true;
      const createdAt = versionCreatedAt.get(m.versionId);
      // 版本查不到时无法证明已提交，保守计入未提交
      if (!createdAt) return true;
      return createdAt < m.lastConfirmedAt;
    });
  }, [memories, lifeVersions]);

  const recent = useMemo(
    () =>
      [...uncommitted]
        .sort((a, b) => b.lastConfirmedAt.localeCompare(a.lastConfirmedAt))
        .slice(0, 6),
    [uncommitted],
  );

  const allCommitted = uncommitted.length === 0;

  return (
    <section className="rounded-lg border border-dashed border-border bg-card/50 p-5">
      <div className="flex items-center gap-2">
        {allCommitted ? (
          <Check className="h-4 w-4 text-olive" />
        ) : (
          <CircleDashed className="h-4 w-4 text-muted-foreground" />
        )}
        <h2 className="text-sm font-medium text-foreground">未提交变更</h2>
        <span className="font-data text-xs text-muted-foreground">{uncommitted.length}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        已确认的长期记忆，还没被写进任何一个版本。
      </p>

      {allCommitted ? (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-olive">
          全部已提交 ✓
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {recent.map((m) => (
            <li key={m.id} className="flex items-baseline gap-3 text-sm leading-relaxed">
              <span
                className={`shrink-0 rounded border px-1.5 py-px font-data text-[10px] tracking-wider ${KIND_STYLE[m.kind]}`}
              >
                {KIND_LABEL[m.kind]}
              </span>
              <span className="text-foreground/85">{m.content}</span>
              <span className="ml-auto shrink-0 font-data text-[11px] text-muted-foreground/70">
                {m.kind === 'insight' && `置信度 ${CONFIDENCE_LABEL[m.confidence]} · `}
                {m.lastConfirmedAt.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
