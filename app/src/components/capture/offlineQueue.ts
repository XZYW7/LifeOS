/**
 * 随手记离线暂存队列（localStorage）。
 * server 不可达时把碎片先存本地；恢复在线后 flushQueue() 自动重发。
 * 重发成功的条目由调用方合并进「今天记了」列表。
 */

export interface QueuedCapture {
  /** 本地生成的临时 id（queued- 前缀，便于 UI 标记） */
  id: string;
  ts: string;
  text: string;
  source: string;
}

const KEY = 'lifeos:capture-queue';

export function readQueue(): QueuedCapture[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it): it is QueuedCapture =>
        !!it && typeof it === 'object' && typeof (it as QueuedCapture).text === 'string',
    );
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedCapture[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // 存储满 / 隐私模式下静默失败，不阻塞主流程
  }
}

export function enqueue(text: string, source: string): QueuedCapture {
  const item: QueuedCapture = {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    text,
    source,
  };
  writeQueue([...readQueue(), item]);
  return item;
}

export function queueSize(): number {
  return readQueue().length;
}

/**
 * 把队列里的碎片逐条重发给 server。
 * 返回重发成功的条目；仍在队列中的保留供下次再试。
 */
export async function flushQueue(
  send: (text: string, source: string) => Promise<unknown>,
): Promise<QueuedCapture[]> {
  const items = readQueue();
  if (items.length === 0) return [];
  const sent: QueuedCapture[] = [];
  const remaining: QueuedCapture[] = [];
  for (const item of items) {
    try {
      await send(item.text, item.source);
      sent.push(item);
    } catch {
      remaining.push(item);
    }
  }
  writeQueue(remaining);
  return sent;
}
