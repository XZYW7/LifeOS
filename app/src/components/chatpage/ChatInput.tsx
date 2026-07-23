/**
 * ChatPage 底部输入区：快捷输入 chips + 输入框。
 * Enter 发送，Shift+Enter 换行。
 */
import { useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useServerStatus } from '@/lib/api';

const QUICK_CHIPS = ['今天很累', '最近有点迷茫', '帮我复盘这周'] as const;

interface Props {
  disabled: boolean;
  onSend: (text: string) => void;
}

export default function ChatInput({ disabled, onSend }: Props) {
  const [value, setValue] = useState('');
  const online = useServerStatus((s) => s.online);
  const llm = useServerStatus((s) => s.llm);
  const modeHint = online
    ? llm
      ? '当前为 LLM 模式，回复基于你的打卡、任务与长期记忆'
      : '当前为本地规则引擎模式（未配置 LLM），回复基于你的打卡、任务与记忆数据'
    : '离线模式 · 本地规则引擎，数据将在核心服务恢复后同步';

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div>
      {/* 快捷输入 */}
      <div className="mb-3 flex flex-wrap gap-2">
        {QUICK_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={disabled}
            onClick={() => submit(chip)}
            className={cn(
              'rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors',
              disabled
                ? 'cursor-not-allowed opacity-50'
                : 'hover:border-brand/40 hover:text-brand',
            )}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* 输入框 */}
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(value);
            }
          }}
          rows={2}
          placeholder="说说你现在的状态、卡住的事，或对方向的怀疑……"
          className="min-h-[44px] flex-1 resize-none rounded-md border border-input bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-brand/50 focus:outline-none"
        />
        <button
          type="button"
          disabled={disabled || !value.trim()}
          onClick={() => submit(value)}
          className={cn(
            'flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md border transition-colors',
            disabled || !value.trim()
              ? 'cursor-not-allowed border-border text-muted-foreground/50'
              : 'border-brand/50 bg-brand/15 text-brand hover:bg-brand/25',
          )}
          aria-label="发送"
        >
          <SendHorizontal className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground/70">
        Enter 发送 · Shift+Enter 换行 · {modeHint}
      </p>
    </div>
  );
}
