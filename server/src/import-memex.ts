/**
 * memex 备份一次性导入（POST /api/import/memex）
 * ─ 解析逻辑移植自 TraceBrain packages/core/src/server/import-export.ts：
 *   · workspace/Cards/**.yaml：title+fact → MemoryEntry（sourceRefs 标 'memex:<fact_id>'）；
 *     带 event/task ui_config 的卡片额外 → Task
 *   · workspace/PKM/**.md（PARA）：正文 → KnowledgeItem
 *   · workspace/ChatSessions/**：跳过
 * ─ 去重：sha256(文件名+内容) 索引 data/memex-import-index.json，重复导入幂等
 * ─ ZIP 解析用 yauzl，YAML 解析用 yaml 包
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import yauzl from 'yauzl';
import YAML from 'yaml';
import { DATA_DIR, loadState, saveState, writeMemoryMd, type LifeOSState } from './store.js';
import type { KnowledgeItem, MemoryEntry, Task } from './types.js';
import { nowIso, todayStr, uid } from './util.js';

const INDEX_PATH = path.join(DATA_DIR, 'memex-import-index.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// ── ZIP 读取（yauzl promisify，只收集目标条目内容） ──

const WANTED = /^workspace\/(Cards\/.*\.yaml|PKM\/.*\.md)$/;
const SKIP_COUNTED = /^workspace\/ChatSessions\//;

interface ZipEntries {
  /** 目标文件：name → 内容 */
  files: Map<string, Buffer>;
  /** ChatSessions 等待计数跳过的条目数 */
  skippedEntries: number;
}

async function readZipEntries(zipPath: string): Promise<ZipEntries> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zf) => {
      if (err || !zf) reject(err ?? new Error('无法打开 zip'));
      else resolve(zf);
    });
  });
  return new Promise<ZipEntries>((resolve, reject) => {
    const files = new Map<string, Buffer>();
    let skippedEntries = 0;
    zip.on('error', reject);
    zip.on('end', () => resolve({ files, skippedEntries }));
    zip.on('entry', (entry: yauzl.Entry) => {
      const name: string = entry.fileName;
      if (/\/$/.test(name)) {
        zip.readEntry();
        return;
      }
      if (SKIP_COUNTED.test(name)) skippedEntries++;
      if (!WANTED.test(name)) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          zip.readEntry();
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('error', () => zip.readEntry());
        stream.on('end', () => {
          files.set(name, Buffer.concat(chunks));
          zip.readEntry();
        });
      });
    });
    zip.readEntry();
  });
}

// ── 去重索引 ──

interface ImportIndexEntry {
  file: string;
  kinds: string[];
  ids: string[];
  importedAt: string;
}

type ImportIndex = Record<string, ImportIndexEntry>;

async function loadIndex(): Promise<ImportIndex> {
  try {
    return JSON.parse(await fs.readFile(INDEX_PATH, 'utf-8')) as ImportIndex;
  } catch {
    return {};
  }
}

async function saveIndex(index: ImportIndex): Promise<void> {
  const tmp = `${INDEX_PATH}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf-8');
  await fs.rename(tmp, INDEX_PATH);
}

function hashEntry(name: string, content: Buffer): string {
  return createHash('sha256').update(name).update('\0').update(content).digest('hex');
}

// ── 解析工具（移植自 import-export.ts） ──

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地日历日 YYYY-MM-DD（避免 UTC 换算把 +08:00 的日期打回前一天） */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 提取日历日：带日期的字符串直接取原文日期部分（保留源时区的日历日），
 * unix 秒时间戳按本机时区换算。
 */
function dateOf(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') {
    const d = new Date(value * 1000);
    return isNaN(d.getTime()) ? undefined : localDate(d);
  }
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : localDate(d);
}

function stripFrontmatter(text: string): { front: AnyRecord; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { front: {}, body: text };
  let front: AnyRecord = {};
  try {
    front = YAML.parse(match[1]) ?? {};
  } catch {
    /* frontmatter 解析失败按无 frontmatter 处理 */
  }
  return { front, body: match[2].trim() };
}

// ── 主流程 ──

export interface MemexImportResult {
  imported: { memories: number; tasks: number; knowledge: number };
  skipped: number;
  errors: string[];
}

export async function importMemex(zipPath: string): Promise<MemexImportResult> {
  const stat = await fs.stat(zipPath).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error(`zip 文件不存在: ${zipPath}`);

  const { files, skippedEntries } = await readZipEntries(zipPath);
  const index = await loadIndex();
  const state: LifeOSState = await loadState();
  // 已有实体 id 集合：用于索引自愈（用户清空数据后，索引说已导入但实体不在 → 重新导入）
  const existingIds = new Set<string>([
    ...state.memories.map((m) => m.id),
    ...state.tasks.map((t) => t.id),
    ...state.knowledge.map((k) => k.id),
  ]);
  const result: MemexImportResult = { imported: { memories: 0, tasks: 0, knowledge: 0 }, skipped: skippedEntries, errors: [] };
  const today = todayStr();
  const userId = state.user.id;

  const newMemories: MemoryEntry[] = [];

  for (const [name, buf] of [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const hash = hashEntry(name, buf);
    const prior = index[hash];
    if (prior) {
      const stillExists = prior.ids.some((id) => existingIds.has(id));
      if (stillExists) {
        result.skipped++;
        continue;
      }
      // 索引残留但实体已被清空：丢弃索引项，允许重新导入
      delete index[hash];
    }
    const ids: string[] = [];
    const kinds: string[] = [];
    const text = buf.toString('utf-8');

    try {
      if (name.startsWith('workspace/Cards/')) {
        // ── Cards YAML → MemoryEntry（+ event/task 卡片 → Task）──
        const card: AnyRecord = YAML.parse(text);
        if (!card || typeof card !== 'object') {
          result.errors.push(`${name}: 卡片 YAML 不是对象`);
          continue;
        }
        const content = [card.title, card.fact].filter(Boolean).join('\n\n');
        if (!content.trim()) {
          result.errors.push(`${name}: 卡片内容为空`);
          continue;
        }
        const createdDate = dateOf(card.created_at ?? card.timestamp);
        const factId = String(card.fact_id || name);
        const mem: MemoryEntry = {
          id: uid('mem'),
          userId,
          kind: 'fact',
          content,
          sourceRefs: [`memex:${factId}`],
          confidence: 'medium',
          superseded: false,
          active: true,
          firstSeenAt: createdDate ?? today,
          lastConfirmedAt: createdDate ?? today,
        };
        state.memories.push(mem);
        newMemories.push(mem);
        ids.push(mem.id);
        kinds.push('memory');
        result.imported.memories++;

        const uiConfigs: AnyRecord[] = Array.isArray(card.ui_configs) ? card.ui_configs : [];
        const eventConfig = uiConfigs.find((u) => u?.template_id === 'event');
        const taskConfig = uiConfigs.find((u) => u?.template_id === 'task');
        if (eventConfig || taskConfig) {
          const cfg = eventConfig ?? taskConfig;
          const taskDate = dateOf(cfg?.data?.start_time ?? cfg?.data?.due_date ?? card.created_at ?? card.timestamp);
          const isCompleted =
            card.status === 'completed' ||
            cfg?.data?.is_completed === true ||
            taskConfig?.data?.is_completed === true;
          const task: Task = {
            id: uid('task'),
            userId,
            title: String(cfg?.data?.title || card.title || content.slice(0, 40)),
            energyCost: 'medium',
            status: isCompleted ? 'done' : 'todo',
            date: taskDate ?? today,
          };
          state.tasks.push(task);
          ids.push(task.id);
          kinds.push('task');
          result.imported.tasks++;
        }
      } else {
        // ── PARA markdown（workspace/PKM/**）→ KnowledgeItem ──
        const { front, body } = stripFrontmatter(text);
        if (!body) {
          result.errors.push(`${name}: markdown 正文为空`);
          continue;
        }
        const title =
          (typeof front.title === 'string' && front.title.trim()) ||
          path.posix.basename(name).replace(/\.md$/, '');
        const item: KnowledgeItem = {
          id: uid('kn'),
          userId,
          type: 'note',
          title,
          content: body,
          goalIds: [],
          projectIds: [],
          para: (() => {
            const part = name.split('/')[2]?.toLowerCase();
            if (part === 'projects' || part === 'areas' || part === 'resources' || part === 'archives') return part.slice(0, -1) as KnowledgeItem['para'];
            return undefined;
          })(),
          createdAt: nowIso(),
        };
        state.knowledge.push(item);
        ids.push(item.id);
        kinds.push('knowledge');
        result.imported.knowledge++;
      }
      index[hash] = { file: name, kinds, ids, importedAt: nowIso() };
    } catch (e) {
      result.errors.push(`${name}: ${(e as Error).message}`);
    }
  }

  await saveState(state);
  for (const mem of newMemories) await writeMemoryMd(mem);
  await saveIndex(index);
  return result;
}
