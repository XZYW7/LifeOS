/**
 * 「今天记了」列表：时间倒序展示当天碎片，支持下拉刷新与刷新按钮。
 * 离线时展示提示；queued- 前缀的条目为本地暂存待同步。
 */
import { CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CaptureItem } from '@/lib/api';

interface Props {
  items: CaptureItem[];
  loading: boolean;
  offline: boolean;
  pendingCount: number;
  onRefresh: () => void;
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TodayCaptures({ items, loading, offline, pendingCount, onRefresh }: Props) {
  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          今天记了
          {items.length > 0 && <span className="font-data ml-1.5 text-brand">{items.length}</span>}
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="刷新列表"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-accent disabled:opacity-40"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} strokeWidth={1.8} />
        </button>
      </div>

      {pendingCount > 0 && (
        <p className="mt-2 text-xs text-brand">有 {pendingCount} 条暂存待同步</p>
      )}

      {offline && items.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
          <CloudOff className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          server 离线中，列表暂时拉不到；写下的内容会先存在本机。
        </div>
      ) : items.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground/70">今天还没有记录，写下第一条吧。</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-data">{fmtTime(item.ts)}</span>
                {item.id.startsWith('queued-') && (
                  <span className="rounded-full border border-brand/40 px-1.5 py-px text-[10px] text-brand">
                    待同步
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {item.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
