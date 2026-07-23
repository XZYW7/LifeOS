/**
 * 「已归档」反馈卡：把 server 返回的 echo 各维度用 chip 列出，逐条小字展示。
 * degraded 时提示「已原文保存，稍后整理」。
 * 离线暂存时（queued）提示恢复在线后自动同步。
 */
import { CheckCircle2, CloudOff, Clock3 } from 'lucide-react';
import type { CaptureEcho } from '@/lib/api';

export type EchoCardData =
  | { kind: 'ok'; text: string; degraded: boolean; echo: CaptureEcho }
  | { kind: 'queued'; text: string };

const DIMENSIONS: { key: keyof CaptureEcho; label: string }[] = [
  { key: 'facts', label: '事实' },
  { key: 'insights', label: '洞察' },
  { key: 'tasks', label: '任务' },
  { key: 'openLoops', label: '开放循环' },
  { key: 'knowledge', label: '知识' },
];

/** echo 条目可能是字符串或对象，尽力取可读文本 */
function itemText(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    for (const k of ['text', 'title', 'content', 'summary', 'name']) {
      if (typeof o[k] === 'string' && o[k]) return o[k] as string;
    }
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  }
  return String(item);
}

export default function CaptureEchoCard({ data }: { data: EchoCardData }) {
  if (data.kind === 'queued') {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm text-brand">
          <CloudOff className="h-4 w-4" strokeWidth={1.8} />
          已离线暂存
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          server 暂时连不上，这条已保存在本机，恢复在线后自动同步。
        </p>
        <p className="mt-2 line-clamp-2 text-sm text-foreground/80">{data.text}</p>
      </div>
    );
  }

  const nonEmpty = DIMENSIONS.filter(({ key }) => (data.echo[key]?.length ?? 0) > 0);

  return (
    <div className="rounded-2xl border border-brand/30 bg-card px-4 py-3.5">
      <div className="flex items-center gap-2 text-sm text-olive">
        <CheckCircle2 className="h-4 w-4 text-brand" strokeWidth={1.8} />
        已归档
      </div>

      {data.degraded && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" strokeWidth={1.8} />
          已原文保存，稍后整理
        </p>
      )}

      {nonEmpty.length > 0 ? (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {nonEmpty.map(({ key, label }) => (
              <span
                key={key}
                className="rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground"
              >
                {label} <span className="font-data text-brand">{data.echo[key].length}</span>
              </span>
            ))}
          </div>
          {nonEmpty.map(({ key, label }) => (
            <div key={key}>
              <div className="text-xs text-muted-foreground">{label}</div>
              <ul className="mt-1 space-y-0.5">
                {data.echo[key].slice(0, 5).map((item, i) => (
                  <li key={i} className="text-xs leading-relaxed text-foreground/85">
                    · {itemText(item)}
                  </li>
                ))}
                {data.echo[key].length > 5 && (
                  <li className="text-xs text-muted-foreground">
                    … 共 {data.echo[key].length} 条
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">已原文保存。</p>
      )}
    </div>
  );
}
