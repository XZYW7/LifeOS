/**
 * Dream 归纳卡片：昨夜 LLM 对全天碎片与状态的跨记录归纳。
 * ─────────────────────────────────────────────
 * - 挂载即拉取 GET /api/dream/latest；server 不可达 / 端点不存在 → 静默不渲染；
 * - dream 为 null → 空态提示 + 「现在归纳」按钮；
 * - 「现在归纳」→ POST /api/dream/run，完成后就地刷新。
 * 语气保持"夜间观察记录"，不评判（与 ModeAnalysisCard 的系统诊断互补）。
 */
import { useEffect, useState } from 'react';
import { Loader2, MoonStar } from 'lucide-react';
import {
  api, markServerOffline, ApiHttpError, useServerStatus,
  type DreamReport,
} from '@/lib/api';
import { todayStr } from '@/lib/store';

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'hidden' } // server 不可达 / 端点未上线 → 静默不渲染
  | { kind: 'ready'; dream: DreamReport | null };

export default function DreamCard() {
  const online = useServerStatus((s) => s.online);
  const checked = useServerStatus((s) => s.checked);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    // 健康检查已确认离线 → 直接静默隐藏，不发请求
    if (checked && !online) {
      setState({ kind: 'hidden' });
      return;
    }
    let cancelled = false;
    api
      .getLatestDream()
      .then((dream) => {
        if (!cancelled) setState({ kind: 'ready', dream });
      })
      .catch((err) => {
        if (cancelled) return;
        // 网络层失败 → 标记离线；HTTP 错误（如端点尚未上线）→ 同样静默隐藏
        if (!(err instanceof ApiHttpError)) markServerOffline();
        setState({ kind: 'hidden' });
      });
    return () => {
      cancelled = true;
    };
  }, [checked, online]);

  const handleRun = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const res = await api.runDream();
      if ('skipped' in res && res.skipped) {
        // server 判定数据不足：维持空态
        setState({ kind: 'ready', dream: null });
      } else {
        setState({ kind: 'ready', dream: res as DreamReport });
      }
    } catch (err) {
      if (err instanceof ApiHttpError) {
        setRunError('归纳失败，请稍后再试');
      } else {
        markServerOffline();
        setState({ kind: 'hidden' });
      }
    } finally {
      setRunning(false);
    }
  };

  // loading（避免闪烁）与 hidden 都不渲染
  if (state.kind !== 'ready') return null;

  const { dream } = state;
  const today = todayStr();
  const rel = dream && (dream.date === today ? '今天' : dream.date === yesterdayStr() ? '昨天' : null);

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MoonStar className="h-3.5 w-3.5 text-brand" strokeWidth={1.8} />
          昨夜归纳{rel ? ` · ${rel}` : ''}
          {dream && !rel && (
            <span className="font-data text-[11px] text-muted-foreground/70">
              归纳日期 {dream.date}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={running}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          ) : (
            <MoonStar className="h-3.5 w-3.5" strokeWidth={1.8} />
          )}
          {running ? '归纳中…' : '现在归纳'}
        </button>
      </div>

      {runError && (
        <div className="mt-3 text-xs text-muted-foreground">{runError}</div>
      )}

      {dream ? (
        <>
          {/* 归纳正文 */}
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
            {dream.summary}
          </p>

          {/* 主题 chips */}
          {(dream.themes ?? []).length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {dream.themes.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* 目标推进 */}
          {(dream.goalProgress ?? []).length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {dream.goalProgress.map((g, i) => (
                <li key={i} className="flex gap-2 text-sm text-olive">
                  <span className="shrink-0 font-data">+</span>
                  <span>
                    {/* 兼容旧缓存里的纯字符串条目 */}
                    {typeof g === 'string' ? (
                      g
                    ) : (
                      <>
                        <span className="font-medium">{g.goal}</span>
                        {g.evidence && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {g.evidence}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* 消耗项 */}
          {(dream.drainers ?? []).length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {dream.drainers.map((d, i) => (
                <li key={i} className="flex gap-2 text-sm text-amber-500/80">
                  <span className="shrink-0 font-data">-</span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          )}

          {/* 建议（引用样式） */}
          {dream.suggestion && (
            <div className="mt-4 border-l-2 border-brand/40 pl-3 text-sm italic leading-relaxed text-muted-foreground">
              「{dream.suggestion}」
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          还没有归纳——今天记几条碎片，今晚或点下方按钮生成。
        </p>
      )}
    </section>
  );
}
