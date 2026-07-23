/**
 * ChatPage 消息气泡：用户右侧 / Agent 左侧。
 * Agent 气泡附带的 AgentAction 渲染为可点击的「采纳调整」按钮。
 */
import { Bot, Check } from 'lucide-react';
import type { AgentAction, ChatMessage } from '@/types';
import { cn } from '@/lib/utils';

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

interface Props {
  message: ChatMessage;
  appliedActions: ReadonlySet<string>;
  onAction: (message: ChatMessage, action: AgentAction, key: string) => void;
}

export default function MessageBubble({ message, appliedActions, onAction }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] sm:max-w-[75%]">
          <div className="rounded-lg border border-border bg-accent px-4 py-3">
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
              {message.content}
            </p>
          </div>
          <div className="mt-1 text-right font-data text-[10px] text-muted-foreground">
            {fmtTime(message.createdAt)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="min-w-0 max-w-[88%] sm:max-w-[85%]">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-brand" strokeWidth={1.8} />
            <span className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">
              LifeOS Agent
            </span>
          </div>
          <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
            {message.content}
          </p>

          {message.actions && message.actions.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              {message.actions.map((action, idx) => {
                const key = `${message.id}:${idx}`;
                const applied = appliedActions.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={applied}
                    onClick={() => onAction(message, action, key)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                      applied
                        ? 'cursor-default border-border bg-transparent text-muted-foreground'
                        : 'border-brand/40 bg-brand/10 text-brand hover:bg-brand/20',
                    )}
                  >
                    {applied && <Check className="h-3.5 w-3.5 shrink-0 text-olive" />}
                    <span className="leading-snug">
                      {applied ? `已采纳 · ${action.label}` : action.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-1 font-data text-[10px] text-muted-foreground">
          {fmtTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}
