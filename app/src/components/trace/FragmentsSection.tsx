/**
 * 轨迹页 ·「碎片」分区：展示随手记 / 对话归档的碎片。
 * ─────────────────────────────────────────────
 * - 数据走 GET /api/captures?date=（不经 store，API 结果存组件本地 state，
 *   不触碰 Zustand 选择器，天然避开"选择器必须返回原始引用"的坑）；
 * - 默认展示今天，底部一行 7 天日期 chip 可切换查看近 7 天；
 * - 最新在前（按 ts 倒序），每条显示时间 + 内容 + source 徽标（chat / 随手记）。
 */
import { useCallback, useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { api, type CaptureItem } from '@/lib/api';
import { cn } from '@/lib/utils';

/** 本地时区的 YYYY-MM-DD（不用 toISOString，避免 UTC 跨日） */
function dateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** 近 7 天的日期列表（今天在前） */
function last7Days(): Array<{ value: string; label: string }> {
  const days: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label =
      i === 0 ? '今天' : i === 1 ? '昨天' : `${d.getMonth() + 1}/${d.getDate()}`;
    days.push({ value: dateStr(d), label });
  }
  return days;
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** source 徽标：chat 归 chat，其余（mobile-web / 随手记入口）归「随手记」 */
function sourceBadge(source?: string): string {
  return source === 'chat' ? 'chat' : '随手记';
}

const DAYS = last7Days();

export default function FragmentsSection() {
  const [date, setDate] = useState(DAYS[0].value);
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const list = await api.getCaptures(d);
      setOffline(false);
      // 最新在前
      setItems([...list].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)));
    } catch {
      setOffline(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  return (
    <section>
      {/* 近 7 天日期切换：轻量 chip 行，可横向滑动 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {DAYS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setDate(value)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs transition-colors',
              date === value
                ? 'border-brand/50 bg-brand/10 text-brand'
                : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load(date)}
          disabled={loading}
          aria-label="刷新碎片列表"
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} strokeWidth={1.8} />
        </button>
      </div>

      {/* 列表 */}
      <div className="mt-4">
        {offline ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
            <CloudOff className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            server 离线中，碎片暂时拉不到。
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">
            {loading ? '加载中…' : '这一天还没有碎片。'}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-data">{fmtTime(item.ts)}</span>
                  <span
                    className={cn(
                      'rounded-full border px-1.5 py-px text-[10px]',
                      item.source === 'chat'
                        ? 'border-olive/40 text-olive'
                        : 'border-brand/40 text-brand',
                    )}
                  >
                    {sourceBadge(item.source)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {item.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
