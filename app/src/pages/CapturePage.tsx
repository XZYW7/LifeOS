/**
 * 移动端随手记页（/capture，独立全屏路由，不进桌面侧边导航）。
 * - 大输入区 + 语音输入，提交后展示 echo 归档反馈；
 * - 「今天记了」列表 + 下拉刷新；
 * - server 离线时内容暂存 localStorage，恢复在线自动重发。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, ApiHttpError } from '@/lib/api';
import type { CaptureItem } from '@/lib/api';
import CaptureComposer from '@/components/capture/CaptureComposer';
import CaptureEchoCard from '@/components/capture/CaptureEchoCard';
import type { EchoCardData } from '@/components/capture/CaptureEchoCard';
import TodayCaptures from '@/components/capture/TodayCaptures';
import { enqueue, flushQueue, queueSize } from '@/components/capture/offlineQueue';

/** 本地时区的 YYYY-MM-DD（不用 toISOString，避免 UTC 跨日） */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** 网络层失败（fetch reject）→ true；HTTP 非 2xx → false */
function isNetworkDown(err: unknown): boolean {
  return !(err instanceof ApiHttpError);
}

export default function CapturePage() {
  const [items, setItems] = useState<CaptureItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(() => queueSize());
  const [feedback, setFeedback] = useState<EchoCardData | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const pullStart = useRef<number | null>(null);
  const [pulling, setPulling] = useState(false);

  /** 拉取当天列表；offline=true 时保留本地暂存条目的展示 */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getCaptures(todayStr());
      setOffline(false);
      setItems((prev) => {
        const queued = prev.filter((it) => it.id.startsWith('queued-'));
        return [...queued, ...list];
      });
    } catch (err) {
      if (isNetworkDown(err)) setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 重发离线队列，成功的条目并入列表后刷新 */
  const syncQueue = useCallback(async () => {
    if (queueSize() === 0) return;
    const sent = await flushQueue((text, source) => api.capture(text, source));
    setPending(queueSize());
    if (sent.length > 0) {
      setItems((prev) => prev.filter((it) => !sent.some((s) => s.id === it.id)));
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    syncQueue();
    const onOnline = () => {
      setOffline(false);
      syncQueue();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh, syncQueue]);

  const handleSend = async (text: string) => {
    setSending(true);
    try {
      const res = await api.capture(text, 'mobile-web');
      setOffline(false);
      setFeedback({ kind: 'ok', text, degraded: !!res.degraded, echo: res.echo });
      await refresh();
    } catch (err) {
      if (isNetworkDown(err)) {
        // server 不可达：暂存本地队列，恢复后自动重发
        const queued = enqueue(text, 'mobile-web');
        setOffline(true);
        setPending(queueSize());
        setFeedback({ kind: 'queued', text });
        setItems((prev) => [
          { id: queued.id, ts: queued.ts, text: queued.text, source: queued.source },
          ...prev,
        ]);
      } else {
        setFeedback({ kind: 'queued', text: `${text}（发送失败：HTTP 错误，请稍后重试）` });
      }
    } finally {
      setSending(false);
    }
  };

  // 触屏下拉刷新：仅在页面滚到顶部时下拉触发
  const onTouchStart = (e: React.TouchEvent) => {
    if (window.scrollY <= 0) pullStart.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (pullStart.current === null) return;
    const dy = e.touches[0].clientY - pullStart.current;
    setPulling(dy > 64);
  };
  const onTouchEnd = () => {
    if (pulling) refresh();
    pullStart.current = null;
    setPulling(false);
  };

  return (
    <div
      ref={rootRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="min-h-screen bg-background text-foreground"
    >
      <div className="mx-auto w-full max-w-md px-5 pb-16 pt-8 sm:pt-12">
        {pulling && <p className="mb-2 text-center text-xs text-brand">松开刷新</p>}

        <header className="flex items-baseline justify-between">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              aria-label="返回 LifeOS 主应用"
              className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-accent"
            >
              <ArrowLeft className="h-5 w-5" strokeWidth={1.8} />
            </Link>
            <h1 className="text-xl font-semibold tracking-wide">
              <span className="text-brand">随手记</span>
            </h1>
          </div>
          <span className="font-data text-xs text-muted-foreground">
            {offline ? '离线' : todayStr()}
          </span>
        </header>

        <div className="mt-5">
          <CaptureComposer onSend={handleSend} sending={sending} />
        </div>

        {feedback && (
          <div className="mt-4">
            <CaptureEchoCard data={feedback} />
          </div>
        )}

        <TodayCaptures
          items={items}
          loading={loading}
          offline={offline}
          pendingCount={pending}
          onRefresh={refresh}
        />
      </div>
    </div>
  );
}
