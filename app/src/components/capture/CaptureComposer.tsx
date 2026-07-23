/**
 * 随手记输入区：自动增高的大 textarea + 发送按钮 + 可选语音输入。
 * 语音：检测 window.SpeechRecognition / webkitSpeechRecognition，
 * 有则显示麦克风按钮（点击开始/停止），识别文字追加进输入框。
 */
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, SendHorizonal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onSend: (text: string) => void;
  sending: boolean;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  const ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
  return ctor ?? null;
}

export default function CaptureComposer({ onSend, sending }: Props) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const speechCtor = useRef(getSpeechRecognitionCtor());

  // 自动增高：随内容扩展，上限约 9 行
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [text]);

  // 挂载后自动聚焦，移动端弹出键盘
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const stopListening = () => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  };

  const toggleVoice = () => {
    if (listening) {
      stopListening();
      return;
    }
    const Ctor = speechCtor.current;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'zh-CN';
    rec.interimResults = false;
    rec.continuous = true;
    rec.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = last?.[0]?.transcript ?? '';
      if (transcript) setText((prev) => (prev ? `${prev}${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (listening) stopListening();
    onSend(trimmed);
    setText('');
    taRef.current?.focus();
  };

  // 桌面端 Ctrl/Cmd+Enter 发送；移动端保持换行
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        enterKeyHint="enter"
        placeholder="此刻在想什么？随手记下来…"
        className={cn(
          'w-full resize-none bg-transparent px-2 py-1.5 text-lg leading-relaxed text-foreground',
          'placeholder:text-muted-foreground/60 focus:outline-none',
        )}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {speechCtor.current && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={listening ? '停止语音输入' : '开始语音输入'}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full border transition-colors',
                listening
                  ? 'border-brand bg-brand/15 text-brand'
                  : 'border-border bg-background/60 text-muted-foreground active:bg-accent',
              )}
            >
              {listening ? (
                <MicOff className="h-5 w-5" strokeWidth={1.8} />
              ) : (
                <Mic className="h-5 w-5" strokeWidth={1.8} />
              )}
            </button>
          )}
          {listening && <span className="text-xs text-brand">正在聆听…</span>}
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className={cn(
            'flex h-11 items-center gap-2 rounded-full px-5 text-base font-medium transition-colors',
            'bg-brand text-primary-foreground active:bg-brand-deep',
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          <SendHorizonal className="h-4 w-4" strokeWidth={1.8} />
          {sending ? '归档中…' : '记下'}
        </button>
      </div>
    </div>
  );
}
