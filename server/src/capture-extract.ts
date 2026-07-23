/**
 * 随手记碎片 LLM 结构化抽取
 * ─ 中文 prompt，只输出 JSON；30s 超时熔断（DeepSeek 经常超过 8s，8s 会静默走降级）
 * ─ 输出维度：facts / insights / tasks / openLoops / stateSignals / knowledge / goalRef
 */
import type { LLMClient } from './llm.js';

export interface CaptureTaskItem {
  title: string;
  /** YYYY-MM-DD；缺省时由调用方落为今天 */
  date?: string;
  energyCost?: 'low' | 'medium' | 'high';
  /** 关联的活跃线程标题（原样回填），落库时匹配为 threadId */
  threadTitle?: string;
}

export interface CaptureOpenLoopItem {
  text: string;
  /** 关联的活跃线程标题（原样回填），落库时匹配为 threadId */
  threadTitle?: string;
}

export interface CaptureKnowledgeItem {
  title: string;
  content: string;
  type?: 'note' | 'method' | 'experience' | 'recipe' | 'guide' | 'resource' | 'paper' | 'idea' | 'learning-log';
  /** 关联的活跃线程标题（原样回填，落库时匹配为 threadId） */
  threadTitle?: string;
}

export interface CaptureGoalRef {
  goalTitle?: string;
  visionTitle?: string;
}

export interface CaptureExtraction {
  facts: string[];
  insights: string[];
  tasks: CaptureTaskItem[];
  openLoops: CaptureOpenLoopItem[];
  stateSignals: string[];
  knowledge: CaptureKnowledgeItem[];
  goalRef: CaptureGoalRef | null;
}

export const EMPTY_EXTRACTION: CaptureExtraction = {
  facts: [],
  insights: [],
  tasks: [],
  openLoops: [],
  stateSignals: [],
  knowledge: [],
  goalRef: null,
};

export interface ExtractContext {
  /** 今天 YYYY-MM-DD，用于相对日期换算 */
  today: string;
  /** 活跃愿景/目标标题列表，供 goalRef 匹配（遗留，线程模型收敛后主要用 activeThreads） */
  activeGoals: { type: 'vision' | 'goal'; title: string }[];
  /** 活跃线程标题列表，供 tasks/openLoops 的 threadTitle 匹配 */
  activeThreads: { title: string; domain: string }[];
}

const EXTRACT_TIMEOUT_MS = 30_000;

function buildPrompt(ctx: ExtractContext): string {
  const goalList =
    ctx.activeGoals.length > 0
      ? ctx.activeGoals.map((g) => `- [${g.type === 'vision' ? '愿景' : '目标'}] ${g.title}`).join('\n')
      : '（当前没有活跃的愿景或目标）';
  const threadList =
    ctx.activeThreads.length > 0
      ? ctx.activeThreads.map((t) => `- [${t.domain}] ${t.title}`).join('\n')
      : '（当前没有活跃线程）';
  return `你是 LifeOS 的碎片整理引擎。用户提交一条随手记碎片，你要把它结构化抽取，挂载到"人生系统"实体上（不是信息卡片分类）。

今天是 ${ctx.today}。用户当前活跃的线程（人生里正在进行的事）：
${threadList}

用户当前活跃的愿景与目标（遗留结构）：
${goalList}

只输出一个 JSON object，禁止输出任何其他文字、解释或代码块标记。结构如下：
{
  "facts": ["..."],
  "insights": ["..."],
  "tasks": [{"title": "...", "date": "YYYY-MM-DD", "energyCost": "low|medium|high", "threadTitle": "..."}],
  "openLoops": [{"text": "...", "threadTitle": "..."}],
  "stateSignals": ["..."],
  "knowledge": [{"title": "...", "content": "..."}],
  "goalRef": {"goalTitle": "...", "visionTitle": "..."}
}

各维度定义：
- facts：客观事实——只记录实际发生了什么（见了谁、做了什么、发生了什么）。别人提出的建议内容本身不要复述成事实。
- insights：认知、感悟、自己形成的判断。
- tasks：明确的行动项（含约定好的会面、要做的事）。date 为约定日/截止日；原文中的相对日期（如"下周三"）必须按今天 ${ctx.today} 换算成绝对日期；没有时间的行动项省略 date 字段。energyCost 按完成它所需精力估计。threadTitle：若该行动明显服务于上面某条活跃线程，把线程标题原样填入；不相关则省略该字段。
- openLoops：待决策、悬而未决、需要再想清楚的事项；别人提出但用户尚未拍板的建议或方向也算（如"要不要先把产品做成小工具试水"）。不要和 tasks 重复。threadTitle 规则同 tasks。
- stateSignals：身体/情绪状态信号，如"头疼""失眠""最近睡得不好""很开心"。只抽取信号本身，短句。
- knowledge：值得以后复用的内容，包括方法、经验、配方、攻略、工具/资源、论文/摘录、想法、学习收获；不限于学术内容。若明显服务某条活跃线程，填 threadTitle。
- goalRef：若碎片内容与上面某个活跃愿景/目标直接相关，把它的标题原样填入对应字段；都不相关则为 null。

规则：
- 没有内容的维度返回空数组 []；goalRef 无匹配返回 null。
- 忠实原文，不要编造原文没有的信息，不要做过度推断。
- facts / insights / openLoops.text 每条不超过 60 字。
- 同一条信息只归入最合适的一个维度，避免重复。`;
}

// ── 输出消毒：LLM JSON 不可信，逐字段校验 ──

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ENERGY_COSTS = new Set(['low', 'medium', 'high']);

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 20);
}

function asTasks(v: unknown): CaptureTaskItem[] {
  if (!Array.isArray(v)) return [];
  const out: CaptureTaskItem[] = [];
  for (const rawItem of v) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const rec = rawItem as Record<string, unknown>;
    if (typeof rec.title !== 'string' || !rec.title.trim()) continue;
    const t: CaptureTaskItem = { title: rec.title.trim() };
    if (typeof rec.date === 'string' && DATE_RE.test(rec.date.trim())) t.date = rec.date.trim();
    if (typeof rec.energyCost === 'string' && ENERGY_COSTS.has(rec.energyCost)) {
      t.energyCost = rec.energyCost as CaptureTaskItem['energyCost'];
    }
    if (typeof rec.threadTitle === 'string' && rec.threadTitle.trim()) {
      t.threadTitle = rec.threadTitle.trim().slice(0, 60);
    }
    out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

/** 兼容 LLM 返回纯字符串数组的旧形态 */
function asOpenLoops(v: unknown): CaptureOpenLoopItem[] {
  if (!Array.isArray(v)) return [];
  const out: CaptureOpenLoopItem[] = [];
  for (const item of v) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ text: item.trim().slice(0, 100) });
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      const text = typeof rec.text === 'string' ? rec.text.trim() : '';
      if (!text) continue;
      const loop: CaptureOpenLoopItem = { text: text.slice(0, 100) };
      if (typeof rec.threadTitle === 'string' && rec.threadTitle.trim()) {
        loop.threadTitle = rec.threadTitle.trim().slice(0, 60);
      }
      out.push(loop);
    }
    if (out.length >= 20) break;
  }
  return out;
}

function asKnowledge(v: unknown): CaptureKnowledgeItem[] {
  if (!Array.isArray(v)) return [];
  const out: CaptureKnowledgeItem[] = [];
  for (const rawItem of v) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const rec = rawItem as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const content = typeof rec.content === 'string' ? rec.content.trim() : '';
    if (!title && !content) continue;
    const allowed = ['note', 'method', 'experience', 'recipe', 'guide', 'resource', 'paper', 'idea', 'learning-log'] as const;
    const item: CaptureKnowledgeItem = { title: title || content.slice(0, 30), content: content || title };
    if (typeof rec.type === 'string' && (allowed as readonly string[]).includes(rec.type)) item.type = rec.type as CaptureKnowledgeItem['type'];
    if (typeof rec.threadTitle === 'string' && rec.threadTitle.trim()) item.threadTitle = rec.threadTitle.trim().slice(0, 60);
    out.push(item);
    if (out.length >= 10) break;
  }
  return out;
}

function asGoalRef(v: unknown): CaptureGoalRef | null {
  if (!v || typeof v !== 'object') return null;
  const rec = v as Record<string, unknown>;
  const ref: CaptureGoalRef = {};
  if (typeof rec.goalTitle === 'string' && rec.goalTitle.trim()) ref.goalTitle = rec.goalTitle.trim();
  if (typeof rec.visionTitle === 'string' && rec.visionTitle.trim()) ref.visionTitle = rec.visionTitle.trim();
  return ref.goalTitle || ref.visionTitle ? ref : null;
}

function sanitize(raw: unknown): CaptureExtraction {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_EXTRACTION };
  const rec = raw as Record<string, unknown>;
  return {
    facts: asStringArray(rec.facts),
    insights: asStringArray(rec.insights),
    tasks: asTasks(rec.tasks),
    openLoops: asOpenLoops(rec.openLoops),
    stateSignals: asStringArray(rec.stateSignals),
    knowledge: asKnowledge(rec.knowledge),
    goalRef: asGoalRef(rec.goalRef),
  };
}

/**
 * 对一条碎片文本做 LLM 结构化抽取。
 * 失败（超时/HTTP 错误/JSON 无法修复）时抛错，由调用方走降级路径。
 */
export async function extractCapture(
  llm: LLMClient,
  text: string,
  ctx: ExtractContext,
): Promise<CaptureExtraction> {
  const raw = await llm.chatJSON<unknown>(
    [
      { role: 'system', content: buildPrompt(ctx) },
      { role: 'user', content: text },
    ],
    { json: true, timeoutMs: EXTRACT_TIMEOUT_MS, temperature: 0.2, maxTokens: 1500, task: 'capture-extract' },
  );
  return sanitize(raw);
}
