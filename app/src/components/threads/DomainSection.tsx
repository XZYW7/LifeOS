/**
 * DomainSection · 单个领域的线程分组
 * ─────────────────────────────────────────────
 * 组头：领域图标 + 名称 + 活跃数。
 * 活跃线程卡片列表 + 已挂起折叠区（默认收起）。
 * 完结 / 释放的线程不在这里出现（它们进了轨迹页的版本叙事）。
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Thread, ThreadDomain } from '@/types';
import ThreadCard from './ThreadCard';
import { DOMAIN_META } from './domain';

interface Props {
  domain: ThreadDomain;
  active: Thread[];
  parked: Thread[];
}

export default function DomainSection({ domain, active, parked }: Props) {
  const [parkedOpen, setParkedOpen] = useState(false);
  const meta = DOMAIN_META[domain];
  const Icon = meta.icon;

  if (active.length === 0 && parked.length === 0) return null;

  return (
    <section className="mt-8">
      <header className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', meta.textClass)} strokeWidth={1.8} />
        <h2 className="text-sm font-medium text-foreground">{meta.label}</h2>
        <span className="font-data text-xs text-muted-foreground">{active.length} 条进行中</span>
      </header>

      {active.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {active.map((t) => (
            <ThreadCard key={t.id} thread={t} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground/70">这个领域目前没有进行中的线程。</p>
      )}

      {parked.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setParkedOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {parkedOpen ? (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            已挂起 {parked.length} 条
            <span className="text-muted-foreground/60">——挂起不是放弃，是托管</span>
          </button>
          {parkedOpen && (
            <ul className="mt-2 space-y-2 opacity-80">
              {parked.map((t) => (
                <ThreadCard key={t.id} thread={t} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
