/**
 * DerivePanel · 从记忆梳理线程
 * ─────────────────────────────────────────────
 * 点击「从记忆梳理线程」→ POST /api/threads/derive 拉取提议（server 不落库）。
 * 提议列表：checkbox 勾选 + 领域下拉（可改）+ 证据摘要。
 * 「采纳所选」逐条创建；409 冲突的条目标红并展示 server hint（先挂起）。
 */
import { useState } from 'react';
import { Brain, Loader2, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useLifeOS, uid, USER_ID } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Thread, ThreadDomain, ThreadProposal } from '@/types';
import { DOMAIN_META, DOMAIN_ORDER } from './domain';

interface Row extends ThreadProposal {
  key: string;
  checked: boolean;
  domain: ThreadDomain;
  /** adopted=已采纳；conflict=409 被拒（带 hint） */
  state: 'pending' | 'adopted' | 'conflict';
  hint?: string;
}

export default function DerivePanel() {
  const addThread = useLifeOS((s) => s.addThread);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [adopting, setAdopting] = useState(false);

  const derive = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const { proposals } = await api.deriveThreads();
      setRows(
        proposals.map((p, i) => ({
          ...p,
          key: `p-${i}`,
          checked: true,
          domain: p.domain,
          state: 'pending',
        })),
      );
    } catch {
      setError('现在梳理不了——server 不在线或归纳失败，稍后再试。');
    } finally {
      setLoading(false);
    }
  };

  const adoptSelected = async () => {
    setAdopting(true);
    // 逐条创建（契约：用户勾选后逐条 POST /api/threads）
    for (const row of rows) {
      if (!row.checked || row.state === 'adopted') continue;
      const now = new Date().toISOString();
      const thread: Thread = {
        id: uid('thread'),
        userId: USER_ID,
        title: row.title,
        domain: row.domain,
        status: 'active',
        note: row.note || undefined,
        sourceRefs: [],
        createdAt: now,
        updatedAt: now,
        lastTouchedAt: now,
      };
      const conflict = await addThread(thread);
      setRows((prev) =>
        prev.map((r) =>
          r.key === row.key
            ? conflict
              ? { ...r, state: 'conflict', hint: conflict }
              : { ...r, state: 'adopted', checked: false }
            : r,
        ),
      );
    }
    setAdopting(false);
  };

  const selectable = rows.filter((r) => r.checked && r.state !== 'adopted').length;

  return (
    <Card className="mt-4 border-border bg-card px-5 py-4">
      <button
        type="button"
        onClick={() => void derive()}
        disabled={loading}
        className="flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-brand disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-brand" strokeWidth={1.8} />
        ) : (
          <Brain className="h-4 w-4 text-brand" strokeWidth={1.8} />
        )}
        从记忆梳理线程
        <span className="ml-auto font-data text-xs text-muted-foreground">
          {loading ? '梳理中…' : open ? '重新梳理' : '让 Agent 提建议'}
        </span>
      </button>

      {open && !loading && (
        <div className="mt-4 border-t border-border pt-4">
          {error && (
            <div className="flex items-center gap-3">
              <p className="text-xs text-destructive">{error}</p>
              <button
                type="button"
                onClick={() => void derive()}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" strokeWidth={1.8} />
                重试
              </button>
            </div>
          )}

          {!error && rows.length === 0 && (
            <p className="text-xs text-muted-foreground">
              暂时没有可梳理出的线程——多记几天随手记再来。
            </p>
          )}

          {rows.length > 0 && (
            <>
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li
                    key={row.key}
                    className={cn(
                      'rounded-md border px-3 py-2.5',
                      row.state === 'conflict'
                        ? 'border-destructive/50 bg-destructive/10'
                        : row.state === 'adopted'
                          ? 'border-border/50 opacity-50'
                          : 'border-border bg-background',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={row.checked}
                        disabled={row.state === 'adopted'}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.key === row.key ? { ...r, checked: e.target.checked } : r,
                            ),
                          )
                        }
                        className="h-3.5 w-3.5 accent-[#d4a04c]"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                        {row.title}
                      </span>
                      <select
                        value={row.domain}
                        disabled={row.state === 'adopted'}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) =>
                              r.key === row.key
                                ? { ...r, domain: e.target.value as ThreadDomain }
                                : r,
                            ),
                          )
                        }
                        className="rounded border border-input bg-card px-2 py-1 text-xs text-foreground focus:outline-none"
                      >
                        {DOMAIN_ORDER.map((d) => (
                          <option key={d} value={d}>
                            {DOMAIN_META[d].label}
                          </option>
                        ))}
                      </select>
                      {row.state === 'adopted' && (
                        <span className="text-xs text-olive">已采纳</span>
                      )}
                    </div>
                    {row.note && (
                      <p className="mt-1 pl-7 text-xs text-muted-foreground">{row.note}</p>
                    )}
                    <p className="mt-1 pl-7 text-[11px] leading-relaxed text-muted-foreground/70">
                      依据：{row.evidenceSummary}
                    </p>
                    {row.state === 'conflict' && row.hint && (
                      <p className="mt-1 pl-7 text-xs text-destructive">{row.hint}</p>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={adopting || selectable === 0}
                  onClick={() => void adoptSelected()}
                  className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40"
                >
                  {adopting ? '采纳中…' : `采纳所选（${selectable}）`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
