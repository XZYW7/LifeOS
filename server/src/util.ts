/** 通用工具：与前端 app/src/lib/store.ts 中的 todayStr/uid 语义一致 */
import { randomUUID } from 'node:crypto';

/** 本地日期 "2026-07-21" */
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** ISO 8601 当前时间 */
export function nowIso(): string {
  return new Date().toISOString();
}
