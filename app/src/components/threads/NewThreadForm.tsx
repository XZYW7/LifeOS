/**
 * NewThreadForm · 新建线程表单
 * ─────────────────────────────────────────────
 * 标题 + 领域选择（四枚图标 pill）+ 可选备注。
 * server 限制活跃线程 ≥5 时返回 409 + hint，此处红字展示（"先挂起一条"）。
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLifeOS, uid, USER_ID } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Thread, ThreadDomain } from '@/types';
import { DOMAIN_META, DOMAIN_ORDER } from './domain';

export default function NewThreadForm() {
  const addThread = useLifeOS((s) => s.addThread);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [domain, setDomain] = useState<ThreadDomain>('career');
  const [hint, setHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setHint(null);
    const now = new Date().toISOString();
    const thread: Thread = {
      id: uid('thread'),
      userId: USER_ID,
      title: title.trim(),
      domain,
      status: 'active',
      note: note.trim() || undefined,
      sourceRefs: [],
      createdAt: now,
      updatedAt: now,
      lastTouchedAt: now,
    };
    const conflict = await addThread(thread);
    setSubmitting(false);
    if (conflict) {
      // 409：活跃 ≥5 等，展示 server 的 hint（如"先挂起一条"）
      setHint(conflict);
      return;
    }
    setTitle('');
    setNote('');
  };

  return (
    <Card className="mt-8 border-border bg-card px-5 py-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Plus className="h-4 w-4 text-brand" strokeWidth={1.8} />
        新线程
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="这条线程叫什么？（如：转型 AI 产品方向）"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="一句话备注（可选）：它现在意味着什么"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="flex flex-wrap items-center gap-2">
          {DOMAIN_ORDER.map((d) => {
            const meta = DOMAIN_META[d];
            const Icon = meta.icon;
            const selected = domain === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDomain(d)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors',
                  selected
                    ? 'border-brand/60 bg-accent text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', meta.textClass)} strokeWidth={1.8} />
                {meta.label}
              </button>
            );
          })}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="ml-auto min-h-[44px] rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-40 md:min-h-0"
          >
            {submitting ? '创建中…' : '开始这条线程'}
          </button>
        </div>

        {hint && <p className="text-xs text-destructive">{hint}</p>}
      </div>
    </Card>
  );
}
