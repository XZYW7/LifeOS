/**
 * VersionsSection · 轨迹页「版本」页签
 * ─────────────────────────────────────────────
 * 自原 TimelinePage 提取：新建版本表单 + 未提交变更 + 竖向 commit 时间线。
 * 复用 components/timeline/ 的 VersionNode / VersionForm / UncommittedChanges。
 */
import { useState } from 'react';
import { GitBranch, Plus, Minus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLifeOS } from '@/lib/store';
import VersionNode from '@/components/timeline/VersionNode';
import VersionForm from '@/components/timeline/VersionForm';
import UncommittedChanges from '@/components/timeline/UncommittedChanges';

export default function VersionsSection() {
  const lifeVersions = useLifeOS((s) => s.lifeVersions);
  const sorted = [...lifeVersions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  );

  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(sorted[0] ? [sorted[0].id] : []),
  );
  const [formOpen, setFormOpen] = useState(false);

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleCreated = (id: string) => {
    setExpandedIds((prev) => new Set(prev).add(id));
    setFormOpen(false);
  };

  return (
    <div>
      {/* 新建版本 */}
      <Card className="border-border bg-card">
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-5 py-4 text-left text-sm font-medium text-foreground transition-colors hover:text-brand"
        >
          {formOpen ? <Minus className="h-4 w-4 text-brand" /> : <Plus className="h-4 w-4 text-brand" />}
          新建版本
          <span className="ml-auto font-data text-xs text-muted-foreground">
            {formOpen ? '收起' : '记录一个阶段'}
          </span>
        </button>
        {formOpen && (
          <div className="border-t border-border px-5 py-5">
            <VersionForm onCreated={handleCreated} />
          </div>
        )}
      </Card>

      {/* 未提交变更 */}
      <div className="mt-6">
        <UncommittedChanges />
      </div>

      {/* 版本时间线 */}
      <div className="relative mt-10">
        {sorted.length > 0 && (
          <div className="absolute bottom-3 left-[9px] top-3 w-px bg-border" aria-hidden />
        )}
        {sorted.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            还没有任何版本。用上方"新建版本"为最近这段日子做一次提交。
          </p>
        ) : (
          <ul>
            {sorted.map((v, i) => (
              <VersionNode
                key={v.id}
                version={v}
                isLatest={i === 0}
                expanded={expandedIds.has(v.id)}
                onToggle={() => toggle(v.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 底部呼应文案 */}
      <footer className="mt-4 flex items-center justify-center gap-2 border-t border-border pt-8 text-sm text-muted-foreground">
        <GitBranch className="h-4 w-4 text-brand-dim" />
        过去的我不是消失了，而是更新了。
      </footer>
    </div>
  );
}
