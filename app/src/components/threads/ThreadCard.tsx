/**
 * ThreadCard · 单条线程卡片
 * ─────────────────────────────────────────────
 * 活跃态：标题 + note + lastTouched 相对时间，操作：挂起 / 完结 / 释放。
 * 挂起态：操作：恢复 / 释放。
 * 「释放」为两段式确认（再点一次确认），防误触。
 * 状态变更走 store.patchThread（乐观更新 + API 同步，409 时红字提示）。
 */
import { useState } from 'react';
import { Pause, Check, Trash2, Play } from 'lucide-react';
import { useLifeOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Thread } from '@/types';
import { DOMAIN_META, relTime } from './domain';
import ThreadLinkage from './ThreadLinkage';

export default function ThreadCard({ thread }: { thread: Thread }) {
  const patchThread = useLifeOS((s) => s.patchThread);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const isActive = thread.status === 'active';

  const change = async (status: Thread['status']) => {
    setHint(null);
    const conflict = await patchThread(thread.id, {
      status,
      lastTouchedAt: new Date().toISOString(),
    });
    if (conflict) setHint(conflict);
  };

  const handleDrop = () => {
    if (!confirmDrop) {
      setConfirmDrop(true);
      return;
    }
    void change('dropped');
  };

  const btnBase =
    'flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

  return (
    <li className="rounded-md border border-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{thread.title}</span>
            {thread.autoCreated && (
              <span className="shrink-0 rounded-full border border-olive/40 bg-olive/10 px-1.5 py-0.5 font-data text-[9px] text-olive">
                自动
              </span>
            )}
          </div>
          {thread.note && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{thread.note}</p>
          )}
        </div>
        <span className="shrink-0 font-data text-[10px] text-muted-foreground/70">
          {relTime(thread.lastTouchedAt ?? thread.updatedAt)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2">
        <span className={cn('mr-auto text-[10px]', DOMAIN_META[thread.domain].textClass)}>
          {DOMAIN_META[thread.domain].label}
        </span>
        {isActive ? (
          <>
            <button type="button" className={btnBase} onClick={() => void change('parked')}>
              <Pause className="h-3 w-3" strokeWidth={1.8} />
              挂起
            </button>
            <button type="button" className={btnBase} onClick={() => void change('done')}>
              <Check className="h-3 w-3" strokeWidth={1.8} />
              完结
            </button>
          </>
        ) : (
          <button type="button" className={btnBase} onClick={() => void change('active')}>
            <Play className="h-3 w-3" strokeWidth={1.8} />
            恢复
          </button>
        )}
        <button
          type="button"
          className={cn(
            btnBase,
            confirmDrop && 'bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive',
          )}
          onClick={handleDrop}
          onBlur={() => setConfirmDrop(false)}
        >
          <Trash2 className="h-3 w-3" strokeWidth={1.8} />
          {confirmDrop ? '确认释放？' : '释放'}
        </button>
      </div>

      <ThreadLinkage thread={thread} />

      {hint && <p className="mt-2 text-xs text-destructive">{hint}</p>}
    </li>
  );
}
