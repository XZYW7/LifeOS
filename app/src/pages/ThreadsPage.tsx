/**
 * ThreadsPage · 线程（你人生里正在进行的事）
 * ─────────────────────────────────────────────
 * 按 4 领域（职业/创造/关系/自我）分组展示线程：
 * 每组内活跃线程卡片（挂起/完结/释放）+ 已挂起折叠区（恢复/释放）。
 * 顶部「+ 新线程」表单与「从记忆梳理线程」（Agent derive 提议，勾选采纳）。
 * 完结/释放的线程不在此展示（它们进入轨迹页的版本叙事）。
 * 数据：selector 返回 store 原始数组引用（稳定），分组在 useMemo 中完成，无需 useShallow。
 */
import { useMemo } from 'react';
import { useLifeOS } from '@/lib/store';
import type { Thread, ThreadDomain } from '@/types';
import NewThreadForm from '@/components/threads/NewThreadForm';
import DerivePanel from '@/components/threads/DerivePanel';
import DomainSection from '@/components/threads/DomainSection';
import { DOMAIN_ORDER } from '@/components/threads/domain';

export default function ThreadsPage() {
  // 原始引用（store 内稳定数组），无新对象 → 无需 useShallow
  const threads = useLifeOS((s) => s.threads);

  const grouped = useMemo(() => {
    const byDomain = new Map<ThreadDomain, { active: Thread[]; parked: Thread[] }>(
      DOMAIN_ORDER.map((d) => [d, { active: [], parked: [] }]),
    );
    for (const t of threads) {
      const bucket = byDomain.get(t.domain);
      if (!bucket) continue;
      if (t.status === 'active') bucket.active.push(t);
      else if (t.status === 'parked') bucket.parked.push(t);
      // done / dropped 不在此展示
    }
    // 最近触碰的排前面
    const byTouched = (a: Thread, b: Thread) =>
      (b.lastTouchedAt ?? b.updatedAt).localeCompare(a.lastTouchedAt ?? a.updatedAt);
    for (const bucket of byDomain.values()) {
      bucket.active.sort(byTouched);
      bucket.parked.sort(byTouched);
    }
    return byDomain;
  }, [threads]);

  const activeTotal = useMemo(
    () => threads.filter((t) => t.status === 'active').length,
    [threads],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      {/* 页头 */}
      <header>
        <h1 className="text-2xl font-semibold text-foreground">线程</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          你人生里正在进行的事——挂起不是放弃，是托管。
        </p>
      </header>

      {/* 概览条 */}
      <div className="mt-6 flex items-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-sm text-muted-foreground">
        <span className="font-data text-base font-semibold text-foreground">{activeTotal}</span>
        条进行中
        <span className="mx-1 text-border">·</span>
        建议同时活跃不超过 5 条，多了就先挂起一条
      </div>

      {/* 新建 + 从记忆梳理 */}
      <NewThreadForm />
      <DerivePanel />

      {/* 4 领域分组 */}
      {DOMAIN_ORDER.map((d) => {
        const bucket = grouped.get(d)!;
        return <DomainSection key={d} domain={d} active={bucket.active} parked={bucket.parked} />;
      })}

      {threads.length === 0 && (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          还没有任何线程。从上方「新线程」开始一条，或让 Agent 从记忆里帮你梳理。
        </p>
      )}
    </div>
  );
}
