/**
 * 随手记碎片管线：原始碎片持久化 + 抽取结果落实体
 * ─ data/captures/YYYY-MM-DD.jsonl：逐行追加原始碎片（id/ts/text/source）
 * ─ 抽取结果写入 state.json 实体（复用 store 追加逻辑），MemoryEntry 同时落 data/memory/ md
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, writeMemoryMd, type LifeOSState } from './store.js';
import type { Goal, KnowledgeItem, MemoryEntry, Task, Vision } from './types.js';
import { nowIso, todayStr, uid } from './util.js';
import type { CaptureExtraction } from './capture-extract.js';
import { resolveThread } from './threads.js';

const CAPTURES_DIR = path.join(DATA_DIR, 'captures');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── 原始碎片 ──────────────────────────────────

export interface RawCapture {
  id: string;
  ts: string;
  text: string;
  source: string;
}

function captureFile(date: string): string {
  return path.join(CAPTURES_DIR, `${date}.jsonl`);
}

/** 追加一条原始碎片到当天 jsonl */
export async function persistRawCapture(text: string, source: string): Promise<RawCapture> {
  await fs.mkdir(CAPTURES_DIR, { recursive: true });
  const raw: RawCapture = { id: uid('cap'), ts: nowIso(), text, source };
  await fs.appendFile(captureFile(todayStr()), JSON.stringify(raw) + '\n', 'utf-8');
  return raw;
}

/** 读取某天的原始碎片（坏行跳过），date 非法或文件不存在返回空 */
export async function listCaptures(date: string): Promise<RawCapture[]> {
  if (!DATE_RE.test(date)) return [];
  let content: string;
  try {
    content = await fs.readFile(captureFile(date), 'utf-8');
  } catch {
    return [];
  }
  const out: RawCapture[] = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const rec = JSON.parse(t) as RawCapture;
      if (rec && typeof rec.id === 'string' && typeof rec.text === 'string') out.push(rec);
    } catch {
      /* 容忍坏行 */
    }
  }
  return out;
}

// ── 抽取结果落实体 ──────────────────────────────────

export interface AppliedEntities {
  memories: MemoryEntry[];
  tasks: Task[];
  knowledge: KnowledgeItem[];
}

function buildMemory(
  state: LifeOSState,
  kind: MemoryEntry['kind'],
  content: string,
  confidence: MemoryEntry['confidence'],
  sourceRefs: string[],
): MemoryEntry {
  const today = todayStr();
  return {
    id: uid('mem'),
    userId: state.user.id,
    kind,
    content,
    sourceRefs,
    confidence,
    superseded: false,
    active: true,
    firstSeenAt: today,
    lastConfirmedAt: nowIso(),
    createdAt: nowIso(),
  };
}

/** 匹配 goalRef 到真实活跃 Goal / Vision（标题精确匹配，其次包含匹配） */
function resolveGoalRef(
  state: LifeOSState,
  extraction: CaptureExtraction,
): { goal?: Goal; vision?: Vision } {
  const ref = extraction.goalRef;
  if (!ref) return {};
  const match = <T extends { title: string }>(list: T[], title?: string): T | undefined => {
    if (!title) return undefined;
    return list.find((x) => x.title === title) ?? list.find((x) => x.title.includes(title) || title.includes(x.title));
  };
  return {
    goal: match(state.goals.filter((g) => g.status === 'active'), ref.goalTitle),
    vision: match(state.visions.filter((v) => v.status === 'active'), ref.visionTitle),
  };
}

/** 匹配 threadTitle 到真实活跃 Thread 的逻辑已收敛到 threads.ts 的 resolveThread（capture/chat/super-agent 共用） */

/**
 * 把抽取结果写入 state（memories + md / tasks / knowledge），返回创建的实体。
 * 只追加，不修改既有实体。
 */
export async function applyExtraction(
  state: LifeOSState,
  extraction: CaptureExtraction,
  captureId: string,
): Promise<AppliedEntities> {
  const applied: AppliedEntities = { memories: [], tasks: [], knowledge: [] };
  const { goal, vision } = resolveGoalRef(state, extraction);
  const goalId = goal?.id;
  const linkedRefs = [captureId, goalId, vision?.id].filter((x): x is string => !!x);

  for (const fact of extraction.facts) {
    const mem = buildMemory(state, 'fact', fact, 'high', linkedRefs);
    state.memories.push(mem);
    applied.memories.push(mem);
  }
  for (const insight of extraction.insights) {
    const mem = buildMemory(state, 'insight', insight, 'medium', linkedRefs);
    state.memories.push(mem);
    applied.memories.push(mem);
  }
  for (const loop of extraction.openLoops) {
    const content = loop.text.startsWith('[开放循环]') ? loop.text : `[开放循环] ${loop.text}`;
    const thread = resolveThread(state, loop.threadTitle);
    const mem = buildMemory(state, 'insight', content, 'medium', [...linkedRefs, thread?.id].filter((x): x is string => !!x));
    state.memories.push(mem);
    applied.memories.push(mem);
  }
  for (const t of extraction.tasks) {
    const thread = resolveThread(state, t.threadTitle);
    const task: Task = {
      id: uid('task'),
      userId: state.user.id,
      title: t.title,
      goalId,
      threadId: thread?.id,
      energyCost: t.energyCost ?? 'medium',
      status: 'todo',
      date: t.date ?? todayStr(),
    };
    state.tasks.push(task);
    applied.tasks.push(task);
  }
  for (const k of extraction.knowledge) {
    const thread = k.threadTitle ? resolveThread(state, k.threadTitle) : undefined;
    const item: KnowledgeItem = {
      id: uid('kn'),
      userId: state.user.id,
      type: k.type ?? 'note',
      title: k.title,
      content: k.content,
      goalIds: goalId ? [goalId] : [],
      projectIds: [],
      ...(thread ? { threadId: thread.id } : {}),
      createdAt: nowIso(),
    };
    state.knowledge.push(item);
    applied.knowledge.push(item);
  }

  for (const mem of applied.memories) await writeMemoryMd(mem);
  return applied;
}

/** LLM 失败降级：原文存为一条 fact 记忆 */
export async function applyCaptureFallback(
  state: LifeOSState,
  text: string,
  captureId: string,
): Promise<AppliedEntities> {
  const mem = buildMemory(state, 'fact', text, 'low', [captureId]);
  state.memories.push(mem);
  await writeMemoryMd(mem);
  return { memories: [mem], tasks: [], knowledge: [] };
}

/** 按 id 删除碎片（Organizer 撤销用）：扫描 captures 目录，重写命中的 jsonl；返回删除条数 */
export async function deleteCaptures(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const target = new Set(ids);
  let files: string[] = [];
  try {
    files = await fs.readdir(CAPTURES_DIR);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const fp = path.join(CAPTURES_DIR, f);
    let content: string;
    try {
      content = await fs.readFile(fp, 'utf-8');
    } catch {
      continue;
    }
    const kept: string[] = [];
    let changed = false;
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const rec = JSON.parse(t) as RawCapture;
        if (rec && typeof rec.id === 'string' && target.has(rec.id)) {
          removed++;
          changed = true;
          continue;
        }
      } catch {
        /* 坏行原样保留 */
      }
      kept.push(t);
    }
    if (changed) await fs.writeFile(fp, kept.length > 0 ? kept.join('\n') + '\n' : '', 'utf-8');
  }
  return removed;
}
