/**
 * 状态存储层
 * ─ data/state.json：全量实体，原子写入（tmp + rename）
 * ─ data/memory/：长期记忆 md+frontmatter 文件（移植 TraceBrain MemoryEngine 的落盘格式，
 *   路径 YYYY/MM/DD-HHMMSS-slug.md；frontmatter 字段换成 LifeOS MemoryEntry）
 * 首次启动 state.json 不存在时初始化为空白合法状态（空集合 + 默认用户 '未命名'），不注入演示种子。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  User, Vision, Goal, Project, Task, DailyState, EnergyMode,
  LifeVersion, MemoryEntry, KnowledgeItem, ChatMessage, Thread, OrganizeRecord,
  UserProfile,
} from './types.js';
import { todayStr, uid, nowIso } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '..', 'data');
export const STATE_PATH = path.join(DATA_DIR, 'state.json');
export const MEMORY_DIR = path.join(DATA_DIR, 'memory');
export const COST_LOG_PATH = path.join(DATA_DIR, 'cost_log.jsonl');

// ── State 形状（与前端 SeedData 一致）──

export interface LifeOSState {
  user: User;
  visions: Vision[];
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  dailyStates: Record<string, DailyState>;
  energyMode: EnergyMode;
  lifeVersions: LifeVersion[];
  memories: MemoryEntry[];
  knowledge: KnowledgeItem[];
  chatMessages: ChatMessage[];
  threads: Thread[];
  /** Organizer 异步整理结果（含 pending/done/failed 状态），供前端轮询 */
  organizeResults: OrganizeRecord[];
  /** 用户画像（memex 摘要层，可选——旧 state.json 没有此字段，缺省兼容） */
  profile?: UserProfile;
}

/** 空白合法状态：空集合 + 默认用户 '未命名'，无演示种子 */
export function buildBlankState(): LifeOSState {
  const now = nowIso();
  const today = todayStr();
  const userId = uid('user');
  return {
    user: {
      id: userId,
      name: '未命名',
      createdAt: now,
      currentEnergyMode: 'medium',
      settings: { timezone: 'Asia/Shanghai' },
    },
    visions: [],
    goals: [],
    projects: [],
    tasks: [],
    dailyStates: {},
    energyMode: {
      userId,
      current: 'medium',
      effectiveFrom: today,
      reason: '初始状态',
      history: [{ level: 'medium', from: today, reason: '初始状态' }],
    },
    lifeVersions: [],
    memories: [],
    knowledge: [],
    chatMessages: [],
    threads: [],
    organizeResults: [],
  };
}

function isValidState(s: unknown): s is LifeOSState {
  const st = s as LifeOSState;
  return !!st && typeof st === 'object' && !!st.user && Array.isArray(st.goals)
    && Array.isArray(st.tasks) && !!st.dailyStates && typeof st.dailyStates === 'object'
    && Array.isArray(st.memories) && Array.isArray(st.chatMessages) && !!st.energyMode;
}

/** 加载状态；不存在或损坏时初始化为空白状态并落盘 */
export async function loadState(): Promise<LifeOSState> {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (isValidState(parsed)) {
      // 缺省补：threads / organizeResults 为后加集合，旧 state.json 没有这些字段
      if (!Array.isArray(parsed.threads)) parsed.threads = [];
      if (!Array.isArray(parsed.organizeResults)) parsed.organizeResults = [];
      // 契约升级兼容：旧的六桶式整理记录没有 receipts 字段，按空回执数组处理
      for (const r of parsed.organizeResults) {
        if (!Array.isArray(r.receipts)) r.receipts = [];
      }
      return parsed;
    }
    console.warn('[store] state.json 结构不合法，重置为空白状态');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[store] state.json 读取失败，重置为空白状态:', (e as Error).message);
    }
  }
  const blank = buildBlankState();
  await saveState(blank);
  return blank;
}

/** 原子写入：tmp + rename */
export async function saveState(state: LifeOSState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STATE_PATH}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmp, STATE_PATH);
}

/**
 * 版本提交打包（git commit 语义）：
 * 把当前全部 active && !superseded 的记忆标上 versionId，版本 memoryIds 写入这些 id。
 * 返回打包条数。Organizer create_version 与手动 POST /api/life-versions 共用，语义一致。
 */
export function packMemoriesIntoVersion(state: LifeOSState, version: LifeVersion): number {
  const packed = state.memories.filter((m) => m.active && !m.superseded);
  for (const m of packed) m.versionId = version.id;
  version.memoryIds = packed.map((m) => m.id);
  return packed.length;
}

// ── Memory md+frontmatter（移植 TraceBrain 落盘格式）──

/** YAML 双引号标量与 JSON 字符串兼容，直接复用 JSON.stringify */
function yq(s: string): string {
  return JSON.stringify(s);
}

function memoryFrontmatter(m: MemoryEntry): string {
  const lines: string[] = [
    `id: ${yq(m.id)}`,
    `userId: ${yq(m.userId)}`,
    `kind: ${yq(m.kind)}`,
  ];
  if (m.sourceRefs.length === 0) {
    lines.push('sourceRefs: []');
  } else {
    lines.push('sourceRefs:');
    for (const r of m.sourceRefs) lines.push(`  - ${yq(r)}`);
  }
  lines.push(
    `confidence: ${yq(m.confidence)}`,
    `superseded: ${m.superseded}`,
    `active: ${m.active}`,
    `firstSeenAt: ${yq(m.firstSeenAt)}`,
    `lastConfirmedAt: ${yq(m.lastConfirmedAt)}`,
  );
  return lines.join('\n');
}

function memoryFilePath(m: MemoryEntry, at: Date): string {
  const y = at.getFullYear();
  const mo = String(at.getMonth() + 1).padStart(2, '0');
  const da = String(at.getDate()).padStart(2, '0');
  const hhmmss = `${String(at.getHours()).padStart(2, '0')}${String(at.getMinutes()).padStart(2, '0')}${String(at.getSeconds()).padStart(2, '0')}`;
  const slug = m.content
    .replace(/[^a-zA-Z0-9一-鿿]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'untitled';
  return path.join(MEMORY_DIR, `${y}`, `${mo}`, `${da}-${hhmmss}-${slug}.md`);
}

async function walkMdFiles(dir: string, out: string[]): Promise<void> {
  try {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walkMdFiles(full, out);
      else if (e.name.endsWith('.md')) out.push(full);
    }
  } catch {}
}

/** 按 id 查找已有记忆文件（用于更新时先删旧文件，避免重复） */
async function findMemoryFileById(id: string): Promise<string | null> {
  const files: string[] = [];
  await walkMdFiles(MEMORY_DIR, files);
  for (const fp of files) {
    try {
      const raw = await fs.readFile(fp, 'utf-8');
      if (raw.includes(`id: ${yq(id)}`)) return fp;
    } catch {}
  }
  return null;
}

/** 写入/更新长期记忆的 md 文件（同 id 旧文件先删除，防止重复） */
export async function writeMemoryMd(m: MemoryEntry): Promise<void> {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
  const old = await findMemoryFileById(m.id);
  const fp = memoryFilePath(m, new Date());
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, `---\n${memoryFrontmatter(m)}\n---\n\n${m.content}\n`, 'utf-8');
  if (old && old !== fp) {
    try { await fs.unlink(old); } catch {}
  }
}

/** 删除某 id 的记忆 md 文件（记忆被 superseded 时保留文件以留审计轨迹，仅在显式删除时用） */
export async function deleteMemoryMd(id: string): Promise<void> {
  const fp = await findMemoryFileById(id);
  if (fp) {
    try { await fs.unlink(fp); } catch {}
  }
}
