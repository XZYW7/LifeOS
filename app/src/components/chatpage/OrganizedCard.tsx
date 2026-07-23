/**
 * OrganizedCard：「已整理」通用回执卡。
 * ─────────────────────────────────────────────
 * 在 Agent 回复气泡下方展示对话整理管线的回执列表：
 * - 挂载后轮询 GET /api/organize/:id（每 1.5s，最多 ~21s），pending 期间不渲染；
 * - done → 逐条渲染 receipts：
 *   · kind='done'       按 tool 显示图标（📝🧩✅☑️🧵📦📊）+ summary，detail 可点击展开；
 *   · kind='skipped'    灰字 summary + skipReason；
 *   · kind='suggestion' 「💡 建议新线程：summary [创建]」，
 *     点创建走现有的 store.addThread（乐观更新 + 409 hint 回滚）；
 *   全部 receipts 为空时显示「这轮没有可整理的内容」；
 * - 底部「撤销这次整理」按钮（failed / 已撤销时不显示）；
 *   撤销成功后卡片呈现已撤销状态（内容弱化 + 「已撤销」标识）。
 * 风格对齐 MessageBubble：暗色、border-border、bg-card、text-xs，低饱和。
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Sparkles, Undo2 } from 'lucide-react';
import { api, type OrganizeResult, type Receipt } from '@/lib/api';
import { initServerSync, useLifeOS, uid, USER_ID } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Thread } from '@/types';

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 14; // ~21s 封顶

type CardState =
  | { phase: 'polling' }
  | { phase: 'done'; result: OrganizeResult }
  | { phase: 'failed' }
  | { phase: 'timeout' };

/** kind='done' 回执的 tool → 图标（未识别的 tool 用 ✨ 兜底） */
const TOOL_ICONS: Record<string, string> = {
  record_memory: '📝',
  record_fragment: '🧩',
  add_task: '✅',
  complete_task: '☑️',
  create_thread: '🧵',
  create_version: '📦',
  fill_checkin: '📊',
  update_thread: '🧵',
};

function receiptKey(r: Receipt, idx: number): string {
  return r.refId ?? `${r.tool}-${idx}`;
}

export default function OrganizedCard({ organizeId }: { organizeId: string }) {
  const addThread = useLifeOS((s) => s.addThread);

  const [state, setState] = useState<CardState>({ phase: 'polling' });
  const [undoing, setUndoing] = useState(false);
  const [undoFailed, setUndoFailed] = useState(false);
  /** 已展开 detail 的回执 key */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  /** 已采纳的建议（key = 回执 key），防止重复创建 */
  const [createdSuggestions, setCreatedSuggestions] = useState<ReadonlySet<string>>(new Set());
  const [suggestionHint, setSuggestionHint] = useState<string | null>(null);

  // 轮询整理状态：done/failed 落定，超时静默放弃
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const poll = async (attempt: number) => {
      try {
        const data = await api.getOrganize(organizeId);
        if (cancelled) return;
        if (data.status === 'done' && data.result) {
          setState({ phase: 'done', result: data.result });
          // Organizer 在服务端异步落库；整理完成后刷新共享状态，让任务/碎片/记忆等页面立即反映结果。
          void initServerSync();
          return;
        }
        if (data.status === 'failed') {
          setState({ phase: 'failed' });
          return;
        }
      } catch {
        // 接口未部署（404）/ 网络失败：按 pending 继续轮询，直到超时静默
        if (cancelled) return;
      }
      if (attempt + 1 >= POLL_MAX_ATTEMPTS) {
        if (!cancelled) setState({ phase: 'timeout' });
        return;
      }
      timer = window.setTimeout(() => void poll(attempt + 1), POLL_INTERVAL_MS);
    };

    void poll(0);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [organizeId]);

  // pending 轮询中 / 超时 / 失败：不渲染卡片主体（failed 给一句轻提示）
  if (state.phase === 'polling' || state.phase === 'timeout') return null;
  if (state.phase === 'failed') {
    return (
      <div className="flex justify-start">
        <p className="max-w-[88%] px-1 font-data text-[10px] text-muted-foreground/60 sm:max-w-[85%]">
          这轮整理没有完成，内容仍以对话形式保留。
        </p>
      </div>
    );
  }

  const result = state.result;
  const undone = result.undone === true;
  const receipts = result.receipts ?? [];

  const doneReceipts = receipts.filter((r) => r.kind === 'done');
  const skippedReceipts = receipts.filter((r) => r.kind === 'skipped');
  const suggestions = receipts.filter((r) => r.kind === 'suggestion');

  // 没有任何落库、跳过或建议时，不占用对话流，也不提供无意义的撤销。
  if (receipts.length === 0 && !undone) return null;

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const createSuggestedThread = async (key: string, r: Receipt) => {
    setSuggestionHint(null);
    const now = new Date().toISOString();
    const thread: Thread = {
      id: uid('thread'),
      userId: USER_ID,
      title: r.summary,
      domain: 'self',
      status: 'active',
      note: r.detail ?? '',
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
      lastTouchedAt: now,
    };
    const conflict = await addThread(thread);
    if (conflict) {
      setSuggestionHint(conflict);
      return;
    }
    setCreatedSuggestions((prev) => new Set(prev).add(key));
  };

  const undo = async () => {
    if (undoing) return;
    setUndoing(true);
    setUndoFailed(false);
    try {
      const res = await api.undoOrganize(organizeId);
      if (res.ok) {
        setState({ phase: 'done', result: { ...result, undone: true } });
      } else {
        setUndoFailed(true);
      }
    } catch {
      setUndoFailed(true);
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="flex justify-start">
      <div className="ml-0 min-w-0 max-w-[88%] sm:max-w-[85%]">
        <div
          className={cn(
            'rounded-lg border border-olive/25 bg-card px-4 py-3',
            undone && 'opacity-60',
          )}
        >
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-olive" strokeWidth={1.8} />
            <span className="font-data text-[10px] uppercase tracking-wider text-olive/80">
              {undone ? '已整理 · 已撤销' : '已整理'}
            </span>
          </div>

          {receipts.length === 0 && (
            <p className="text-xs text-muted-foreground">这轮没有可整理的内容。</p>
          )}

          {/* 已完成动作：图标 + summary，detail 可展开 */}
          {doneReceipts.length > 0 && (
            <ul className="space-y-1 break-words text-xs leading-snug text-foreground/85">
              {doneReceipts.map((r, idx) => {
                const key = receiptKey(r, idx);
                const isOpen = expanded.has(key);
                return (
                  <li key={key}>
                    <div className="flex items-start gap-1.5">
                      <span className="shrink-0">{TOOL_ICONS[r.tool] ?? '✨'}</span>
                      <span className="min-w-0 flex-1">{r.summary}</span>
                      {r.detail && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(key)}
                          aria-label={isOpen ? '收起详情' : '展开详情'}
                          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <ChevronDown
                            className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')}
                            strokeWidth={1.8}
                          />
                        </button>
                      )}
                    </div>
                    {r.detail && isOpen && (
                      <p className="ml-5 mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-muted-foreground">
                        {r.detail}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* 跳过的动作：灰字 + skipReason */}
          {skippedReceipts.length > 0 && (
            <ul className="mt-1.5 space-y-1 break-words text-xs leading-snug text-muted-foreground/70">
              {skippedReceipts.map((r, idx) => (
                <li key={receiptKey(r, idx)}>
                  <span className="mr-1.5">·</span>
                  {r.summary}
                  {r.skipReason && (
                    <span className="text-muted-foreground/50"> — {r.skipReason}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* 建议行：建议新线程（已撤销时不显示） */}
          {!undone && suggestions.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-border/60 pt-2.5">
              {suggestions.map((r, idx) => {
                const key = receiptKey(r, idx);
                const created = createdSuggestions.has(key);
                return (
                  <div
                    key={key}
                    className="flex flex-wrap items-center gap-1.5 text-xs leading-snug"
                  >
                    <span className="text-foreground/85">
                      💡 建议新线程：{r.summary}
                      {r.detail && <span className="text-muted-foreground"> — {r.detail}</span>}
                    </span>
                    <button
                      type="button"
                      disabled={created}
                      onClick={() => void createSuggestedThread(key, r)}
                      className={cn(
                        'rounded-md border px-2 py-0.5 font-data text-[10px] transition-colors',
                        created
                          ? 'cursor-default border-border text-muted-foreground'
                          : 'border-brand/40 bg-brand/10 text-brand hover:bg-brand/20',
                      )}
                    >
                      {created ? '已创建' : '创建'}
                    </button>
                  </div>
                );
              })}
              {suggestionHint && <p className="text-xs text-destructive">{suggestionHint}</p>}
            </div>
          )}

          {/* 撤销（failed / 已撤销时不显示） */}
          {!undone && (
            <div className="mt-3 border-t border-border/60 pt-2.5">
              <button
                type="button"
                disabled={undoing}
                onClick={() => void undo()}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <Undo2 className="h-3 w-3" strokeWidth={1.8} />
                {undoing ? '撤销中…' : '撤销这次整理'}
              </button>
              {undoFailed && (
                <p className="mt-1 text-xs text-destructive">撤销失败，稍后再试。</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
