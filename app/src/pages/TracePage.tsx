/**
 * TracePage · 轨迹（时间线 + 记忆库合并）
 * ─────────────────────────────────────────────
 * 五个页签：版本（Git commit 风格人生版本）/ 碎片 / 记忆 / 知识 / 任务记录。
 * 「版本」复用 components/timeline/ 组件（VersionsSection），
 * 「碎片」走 GET /api/captures（API 数据存 FragmentsSection 本地 state），
 * 其余三个页签直接复用 components/memory/ 的 Section 组件。
 * 数据只读，selector 均返回 store 原始引用（稳定数组），无需 useShallow。
 */
import { useState } from 'react';
import { GitBranch, Puzzle, Brain, BookOpen, ListChecks } from 'lucide-react';
import { useLifeOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import VersionsSection from '@/components/trace/VersionsSection';
import FragmentsSection from '@/components/trace/FragmentsSection';
import MemorySection from '@/components/memory/MemorySection';
import KnowledgeSection from '@/components/memory/KnowledgeSection';
import TaskSection from '@/components/memory/TaskSection';

const TABS = [
  { key: 'versions', label: '版本', icon: GitBranch },
  { key: 'fragments', label: '碎片', icon: Puzzle },
  { key: 'memory', label: '记忆', icon: Brain },
  { key: 'knowledge', label: '知识', icon: BookOpen },
  { key: 'tasks', label: '任务记录', icon: ListChecks },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function TracePage() {
  // 返回原始引用（store 内稳定数组），无新对象 → 无需 useShallow
  const memories = useLifeOS((s) => s.memories);
  const knowledge = useLifeOS((s) => s.knowledge);
  const tasks = useLifeOS((s) => s.tasks);

  const [tab, setTab] = useState<TabKey>('versions');

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      {/* 页头 */}
      <header>
        <h1 className="text-2xl font-semibold text-foreground">轨迹</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          过去的我不是消失了，而是更新了。
        </p>
      </header>

      {/* 页签：移动端可横向滑动，不挤压换行 */}
      <div className="mt-8 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 pb-2.5 pt-1 text-sm transition-colors',
              tab === key
                ? 'border-brand font-medium text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </div>

      {/* 分区内容 */}
      <div className="mt-6">
        {tab === 'versions' && <VersionsSection />}
        {tab === 'fragments' && <FragmentsSection />}
        {tab === 'memory' && <MemorySection memories={memories} />}
        {tab === 'knowledge' && <KnowledgeSection knowledge={knowledge} />}
        {tab === 'tasks' && <TaskSection tasks={tasks} />}
      </div>
    </div>
  );
}
