/**
 * LifeOS SuperAgent —— 移植自 TraceBrain packages/core/src/agent/super-agent.ts 的管线模式：
 *   规则 fast path → LLM 意图分类 → postProcessIntent 规则纠偏 → Specialist 中文 prompt 回复
 * 与 TraceBrain 的差异：
 *   - 意图集合换成 LifeOS 场景（recovery/doubt/motivation/review/query/plan/chat）
 *   - Specialist 不直接操作外部系统，而是返回结构化 JSON {reply, actions}，
 *     actions 由 server 侧用规则引擎 hydrate（apply_plan 的 TodayPlan 由 server 计算，不让 LLM 编造）
 * 职责边界（两道工序的第一道）：本通道只负责「回复」——reply + set_mode/apply_plan/freeze_plan。
 * 记忆/任务/碎片/线程/状态等数据沉淀全部移交第二道：organizer.ts 的异步 Organizer。
 * 回复风格铁律：观察 → 归因 → 建议，不空洞安慰。
 */
import type {
  AgentAction, AgentAnalysis, ChatMessage, DailyState,
  EnergyLevel, Goal, KnowledgeItem, LifeVersion, MemoryEntry, Task, Thread, User, UserProfile, Vision,
} from './types.js';
import type { LLMClient, LLMMessage } from './llm.js';
import { analyzeState, generateTodayPlan, TIRED_KW, EMPTY_KW, DOUBT_KW, REVIEW_KW } from './agent-rules.js';
import { todayStr } from './util.js';

export type LifeOSIntent =
  | 'recovery'   // 疲劳 / 恢复需求
  | 'doubt'      // 方向怀疑
  | 'motivation' // 动力不足 / 意义缺失
  | 'review'     // 复盘请求
  | 'query'      // 查询自己的状态/目标/记忆
  | 'plan'       // 任务与计划安排
  | 'chat';      // 一般性对话

export interface ChatSnapshot {
  user: User;
  visions: Vision[];
  goals: Goal[];
  tasks: Task[];
  threads: Thread[];
  states: DailyState[]; // 全量，按日期升序
  recentStates: DailyState[]; // 近 7 天
  recentCaptures?: { date: string; text: string; source: string }[]; // 近 7 天碎片（对话+随手记同池）
  memories: MemoryEntry[];
  /** 知识库（广义：方法/经验/配方/攻略/资源/论文/学习笔记/想法，按主题沉淀） */
  knowledge: KnowledgeItem[];
  /** 用户画像（memex 摘要层，读端全量注入；无画像时缺省） */
  profile?: UserProfile;
  chatMessages: ChatMessage[]; // 近 10 条
  lifeVersions: LifeVersion[]; // 人生版本记录（Organizer 的 create_version 工具起草上下文）
}

export interface AgentOutput {
  reply: string;
  actions: AgentAction[];
  /** 与回复同一份结构化输出产生的待办承诺；由 Organizer 校验并落库。 */
  taskIntents: TaskIntent[];
  /** 与回复同一份结构化输出产生的已有待办修改。 */
  taskUpdates: TaskUpdateIntent[];
  intent: LifeOSIntent;
  analysis: AgentAnalysis;
}

export interface TaskIntent {
  title: string;
  /** YYYY-MM-DD；未指定日期时由服务端落为今天 */
  date?: string;
  recurrence?: 'daily' | 'weekly' | 'monthly';
  threadTitle?: string;
}

export interface TaskUpdateIntent {
  taskTitle: string;
  newThreadTitle?: string;
}

// ── Persona 与输出契约 ──────────────────────────────────

const PERSONA = `你是 LifeOS 的 AI Agent——用户「人生操作系统」里的长期陪伴者。你不是客服，也不是鸡汤博主。

回复铁律：观察 → 归因 → 建议
1. 观察：先引用你看到的真实数据（能量记录、睡眠、任务完成情况、历史模式），不要凭空说"我理解你"。
2. 归因：给出可证伪的判断（恢复需求 / 动力不足 / 情绪性低落 / 常规波动），并说明把握程度。不确定就说不确定。
3. 建议：给具体、可执行、今天就能做的动作。砍量时必须明确"顺延不是失败"。

禁止：空洞安慰（"加油""你已经很棒了"）、说教、罗列流水账、英文。
语气：冷静、直接、像一个足够了解用户的搭档。中文回复，正文 150-250 字。

能力边界（重要）：你不是只能聊天的助手。你的回复发出后，系统的整理通道会自动执行实际操作：勾掉用户说已完成的事、把用户说要做的事记成待办并挂线程、创建阶段版本记录、创建/暂停/完结线程、沉淀记忆与碎片、补今日打卡。因此：
- 用户说"帮我记录/记个版本/我完成了xx/记下xx"时，直接用确认语气回应（如"好，这段我给你记下了"），绝不要说"我无法操作""我做不到""请你去别处记录"。
- 禁止提及任何外部产品（Memex、Notion、Todoist 等）：用户的历史数据已全部导入本系统，LifeOS 是唯一的记录工具。上下文记忆里出现的"Memex"只是历史数据来源，不是现在可用的工具。`;

const OUTPUT_CONTRACT = `只输出 JSON，不要解释，不要 markdown 代码块：
{
  "reply": "给用户的中文回复（遵循观察→归因→建议）",
  "actions": [
    {"type": "set_mode|apply_plan|freeze_plan",
     "label": "动作的人类可读说明（UI 按钮文案）"}
  ],
  "taskIntents": [
    {"title": "用户已确认要做的事项", "date": "YYYY-MM-DD，可选", "recurrence": "daily|weekly|monthly，可选", "threadTitle": "仅可填写上下文中已有的活跃线程标题，可选"}
  ],
  "taskUpdates": [
    {"taskTitle": "已有待办的原标题或唯一关键词", "newThreadTitle": "目标活跃线程标题"}
  ]
}
actions、taskIntents 和 taskUpdates 都可以是空数组。
actions 约束：set_mode/apply_plan 只在你确认需要调整今日能量档位或重排计划时给出，最多各一个；plan 内容由系统计算，你不要编造任务列表。
待办承诺约束：只有用户明确提出或确认的事项才写 taskIntents；可以是一次性任务，也可以带 recurrence。不要把你自己的建议擅自变成任务。若用户回答“是的/就这么办”来确认你上一轮已列出的计划，可以把那份计划写入 taskIntents。若 reply 说“已创建/已拆成待办/会按周期出现”，taskIntents 必须有对应条目；若没有条目，回复不得作这种承诺。
已有待办修改约束：用户明确要求改期、改周期、改归属线程时，必须写 taskUpdates；若 reply 说“已挪到某线程/已修改”，taskUpdates 必须有对应条目。不能只把这种操作记录成一条记忆。修改已有任务和新建任务互斥：同一事项已有待办时，只写 taskUpdates，绝不再写 taskIntents 创建副本。
职责边界：记忆/碎片/线程/状态等数据沉淀仍由后台 Organizer 负责；不要输出 memories 或 add_task。`;

// ── Specialist 中文 prompt（移植 TraceBrain 8 个 Specialist 的形态，按 LifeOS 场景重写）──

const SPECIALIST_PROMPTS: Record<LifeOSIntent, string> = {
  recovery: `【场景：疲劳/恢复需求】用户在表达累、疲惫、透支。
- 结合上下文里规则引擎的判定结果说话，引用连续高强度天数、睡眠数据。
- 若确认恢复需求：建议进入省电模式，砍量但保留与长期目标的最小连接；actions 给 set_mode + apply_plan。
- 若数据不支持恢复需求：明说"这可能是一日内波动"，给中等把握的归因，不要顺着用户的情绪加重判断。`,
  doubt: `【场景：方向怀疑】用户在怀疑当前方向/路径，这是规则引擎的边界。
- 先确认：这不是疲惫，是方向感的问题，比疲惫重要。
- 不要给任何任务建议；actions 给 freeze_plan。
- 问 1-2 个开放式问题：这种怀疑是什么时候开始的？怀疑的是领域本身，还是通往它的路径？`,
  motivation: `【场景：动力不足】用户能量正常但回避目标相关任务，或表达"没意义/提不起劲"。
- 区分两种归因：任务粒度太大（拆小到今天 15 分钟能启动）vs 与长期目标的连接感变弱（重新对齐 vision）。
- 不要把动力不足误判为需要休息；不建议躺平。`,
  review: `【场景：复盘请求】用户要求总结/回顾近期状态。
- 数据来源优先级：近 7 天碎片（一手生活记录，最重要）→ 用户画像与未入画像的新记忆 → DailyState 打卡。三者都是"记录"，不要只数打卡天数。
- 打卡天数少不代表没有记录：打卡缺失时明说"打卡只有 N 天"，但复盘内容必须基于碎片和记忆展开，不能说"数据不足无法复盘"。
- 用具体内容说话：引用碎片/记忆里的真实事件（日期+事情），指出一个最值得注意的点，给一条下周可执行的调整建议。`,
  query: `【场景：查询】用户在问自己的状态、目标、记忆或进度。
- 只根据上下文提供的数据回答，不要编造。没有数据就明说"还没有相关记录"。
- 回答后可以给一句基于数据的观察，但不要强行给建议。`,
  plan: `【场景：计划安排】用户在讨论任务安排、今日计划、增减任务。
- 结合当前能量档位给安排建议；用户明确提到要做的事会在后台自动整理落库，你不需要输出 add_task。
- 低能量时主动提醒砍量，重申"顺延不是失败"。`,
  chat: `【场景：一般性对话】用户在闲聊或分享日常。
- 自然、简短、像搭档，不过度热情。
- 可以结合状态数据给一句真实观察，但不要每次都分析用户。`,
};

// ── 意图分类（规则 fast path → LLM → postProcessIntent 纠偏）──

const INTENT_SYSTEM = `你是 LifeOS 的意图路由器。判断用户消息的意图，只输出 JSON。
可选意图：
- recovery：用户表达累、疲惫、没睡好、透支、身体状态差。
- doubt：用户在怀疑人生/职业方向本身（"要不要继续""是不是走错了""想放弃这个方向"）。
- motivation：用户能量正常但不想做正事、觉得没意义、拖延、提不起劲。
- review：用户要求总结、复盘、回顾最近状态。
- query：用户在询问自己的状态、目标、记忆、进度（"...吗？""我最近在...？"）。
- plan：用户在安排任务、讨论今天要做什么、加减任务。
- chat：一般性闲聊、打招呼、分享日常。

输出 JSON：{"intent": "...", "confidence": 0.0-1.0}
规则：只输出 JSON；方向问题（doubt）优先于普通情绪低落（recovery/motivation）。`;

export class SuperAgent {
  constructor(private llm: LLMClient) {}

  /** 移植自 TraceBrain postProcessIntent：对 LLM 分类结果做规则纠偏 */
  private postProcessIntent(text: string, intent: LifeOSIntent): LifeOSIntent {
    const lower = text.toLowerCase();

    // 1. 已完成/状态描述不是计划安排
    if (intent === 'plan' && /(已经|完成|做完|结束|搞定).*/.test(lower)) {
      return 'chat';
    }

    // 2. 休闲/社交活动（含时间词）不是任务计划
    if (intent === 'plan' && /(咖啡|奶茶|电影|游戏|逛街|散步|聚餐|约会|听歌).*/.test(lower)) {
      return 'chat';
    }

    // 3. 明显的方向词被误判为普通疲劳时纠回 doubt
    if (intent === 'recovery' && /(方向|不适合|要不要继续|走错|放弃.*(方向|目标|这条路))/.test(lower)) {
      return 'doubt';
    }

    return intent;
  }

  private async classifyIntent(text: string): Promise<LifeOSIntent> {
    const lower = text.toLowerCase();

    // 规则 fast path（与规则引擎关键词表一致，避免 LLM 误判高确定性场景）
    if (DOUBT_KW.test(lower)) return 'doubt';
    if (REVIEW_KW.test(lower)) return 'review';
    if (TIRED_KW.test(lower)) return 'recovery';
    if (EMPTY_KW.test(lower)) return 'motivation';
    if (/[?？]$/.test(lower) || /^(我有什么|我最近|帮我查|查一下|看看)/.test(lower)) return 'query';

    // LLM 分类
    const result = await this.llm.chatJSON<{ intent?: string }>(
      [
        { role: 'system', content: INTENT_SYSTEM },
        { role: 'user', content: text },
      ],
      { temperature: 0.1, maxTokens: 128, task: 'classify' },
    );
    const raw = (result.intent ?? 'chat') as LifeOSIntent;
    const intent: LifeOSIntent = raw in SPECIALIST_PROMPTS ? raw : 'chat';
    return this.postProcessIntent(text, intent);
  }

  // ── 上下文组装 ──────────────────────────────────

  private buildContextBlock(snapshot: ChatSnapshot, analysis: AgentAnalysis): string {
    const { user, threads, recentStates, memories, tasks } = snapshot;
    const parts: string[] = [];

    parts.push(`【用户】${user.name}，当前能量模式：${user.currentEnergyMode}` +
      (user.lifeStageTag ? `，人生阶段：${user.lifeStageTag}` : ''));

    // 画像层读端：全量注入（memex——写端控制体积，读端全量注入）；无画像时跳过
    if (snapshot.profile?.content) {
      parts.push(`【用户画像】（由长期记忆蒸馏的摘要层，代表你对用户的整体认识）\n${snapshot.profile.content}`);
    }

    // 未入画像的新记忆 buffer：lastConfirmedAt 晚于 profile.updatedAt 的活跃记忆（最多 10 条）。
    // 无画像时全部活跃记忆都未入画像，等价于原来的「近期确认的记忆」。
    const profileDate = (snapshot.profile?.updatedAt ?? '').slice(0, 10);
    const bufferMems = memories
      .filter((m) => m.active && !m.superseded && m.lastConfirmedAt.slice(0, 10) > profileDate)
      .sort((a, b) => b.lastConfirmedAt.localeCompare(a.lastConfirmedAt))
      .slice(0, 10);
    if (bufferMems.length > 0) {
      parts.push('【未入画像的新记忆】（画像尚未覆盖的新证据，逐条补充画像）' +
        bufferMems.map((m) => `${m.lastConfirmedAt.slice(0, 10)} (${m.kind}) ${m.content.replace(/\n+/g, ' ').slice(0, 60)}`).join('；'));
    }

    // 近 7 天碎片（对话+随手记），复盘和状态判断的一手生活记录
    const caps = snapshot.recentCaptures ?? [];
    if (caps.length > 0) {
      parts.push('【近 7 天碎片】\n' + caps.slice(-25).map((c) => `${c.date} [${c.source}] ${c.text.replace(/\n+/g, ' ').slice(0, 80)}`).join('\n'));
    } else {
      parts.push('【近 7 天碎片】无');
    }

    // 相关知识：优先与活跃线程匹配的知识，再按 createdAt 取最近补足，共 ≤8 条
    const knowledge = snapshot.knowledge ?? [];
    if (knowledge.length > 0) {
      const activeThreadIds = new Set(threads.filter((t) => t.status === 'active').map((t) => t.id));
      const sorted = [...knowledge].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const picked = [
        ...sorted.filter((k) => k.threadId && activeThreadIds.has(k.threadId)),
        ...sorted.filter((k) => !k.threadId || !activeThreadIds.has(k.threadId)),
      ].slice(0, 8);
      const typeLabels: Record<KnowledgeItem['type'], string> = {
        note: '笔记', method: '方法', experience: '经验', recipe: '配方', guide: '攻略',
        resource: '资源', paper: '论文', idea: '想法', 'learning-log': '学习记录',
      };
      parts.push('【相关知识】（用户沉淀的可复用知识：方法/经验/配方/攻略/资源/论文/学习收获；用户问起时据实引用）\n' +
        picked.map((k) => {
          const th = k.threadId ? threads.find((t) => t.id === k.threadId) : undefined;
          return `《${k.title}》（${typeLabels[k.type] ?? k.type}${th ? `，线程：${th.title}` : ''}）：${k.content.replace(/\n+/g, ' ').slice(0, 80)}`;
        }).join('\n'));
    }

    if (recentStates.length > 0) {
      const lines = recentStates.map((s) =>
        `${s.date} 能量${s.energy}` +
        (s.sleepHours != null ? ` 睡眠${s.sleepHours}h` : '') +
        (s.note ? ` 记录："${s.note}"` : '') +
        ` 身体:${s.body.tag} 情绪:${s.emotion.tag} 学习:${s.learning.tag}`,
      );
      parts.push('【近 7 天 DailyState】\n' + lines.join('\n'));
    } else {
      parts.push('【近 7 天 DailyState】无打卡记录（注意：无打卡 ≠ 无记录，碎片和记忆里仍有大量近期生活痕迹）');
    }

    // 线程模型收敛：愿景降级为一句话，目标树替换为活跃线程
    if (user.visionText) {
      parts.push(`【愿景】${user.visionText}`);
    }

    const activeThreads = threads.filter((t) => t.status === 'active');
    if (activeThreads.length > 0) {
      parts.push('【活跃线程】' + activeThreads
        .map((t) => `[${t.domain}] ${t.title}${t.note ? `（${t.note}）` : ''}`)
        .join('；'));
    }

    const today = todayStr();
    const todayTasks = tasks.filter((t) => t.date === today && t.status !== 'done');
    if (todayTasks.length > 0) {
      parts.push('【今日未完成计划】' + todayTasks.map((t) => `${t.id}:${t.title}(能耗${t.energyCost})`).join('；'));
    }

    parts.push(
      `【规则引擎判定】规则 ${analysis.rule}，归因 ${analysis.diagnosis}，置信 ${analysis.confidence}，` +
      `建议模式 ${analysis.suggestedMode}。证据：${analysis.evidence || '无'}。` +
      (analysis.patterns.length > 0 ? `模式：${analysis.patterns.join('；')}。` : '') +
      `（这是确定性规则的结果，你的归因应与之对照；若你认为规则判错了，说明理由。）`,
    );

    return parts.join('\n\n');
  }

  private buildHistory(messages: ChatMessage[]): LLMMessage[] {
    return messages.slice(-10).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));
  }

  // ── actions 白名单校验 + server 侧 hydrate ──────────────────────────────────

  private hydrateActions(
    rawActions: unknown,
    intent: LifeOSIntent,
    analysis: AgentAnalysis,
    snapshot: ChatSnapshot,
  ): AgentAction[] {
    if (!Array.isArray(rawActions)) return [];
    const actions: AgentAction[] = [];
    const seen = new Set<string>();
    const taskIds = new Set(snapshot.tasks.map((t) => t.id));

    for (const raw of rawActions.slice(0, 4)) {
      const a = raw as Record<string, unknown>;
      const type = a?.type as AgentAction['type'];
      if (!type || seen.has(type)) continue;
      const label = typeof a?.label === 'string' && a.label ? a.label : '';

      switch (type) {
        case 'set_mode': {
          const mode: EnergyLevel = analysis.suggestedMode;
          seen.add(type);
          actions.push({
            type, mode, reason: analysis.diagnosis,
          label: `切换到${{ high: '高性能', medium: '平衡', low: '省电' }[mode]}模式`,
          });
          break;
        }
        case 'apply_plan': {
          const plan = generateTodayPlan(analysis, snapshot.goals, snapshot.tasks, snapshot.user.id);
          seen.add(type);
          actions.push({
            type, plan, mode: plan.mode,
            label: `应用今日调整（${plan.keptTasks.length + plan.minimalConnections.length} 件保留 / ${plan.deferredTasks.length} 件顺延）`,
          });
          break;
        }
        case 'freeze_plan': {
          seen.add(type);
          actions.push({ type, label: '冻结今日计划（不做自动重排）', reason: intent === 'doubt' ? 'direction_doubt' : intent });
          break;
        }
        // add_task 已移除：任务沉淀移交 Organizer（organizer.ts）直接落库
        case 'defer_task':
        case 'keep_task':
        case 'split_task': {
          const taskId = typeof a?.taskId === 'string' ? a.taskId : '';
          if (!taskIds.has(taskId)) break; // 只允许引用真实任务
          seen.add(type);
          actions.push({ type, taskId, label: label || type });
          break;
        }
        default:
          break;
      }
    }
    return actions;
  }

  private hydrateTaskIntents(rawTasks: unknown, snapshot: ChatSnapshot): TaskIntent[] {
    if (!Array.isArray(rawTasks)) return [];
    const activeTitles = new Set(snapshot.threads.filter((thread) => thread.status === 'active').map((thread) => thread.title));
    const seen = new Set<string>();
    const tasks: TaskIntent[] = [];
    for (const raw of rawTasks.slice(0, 2)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const title = typeof item.title === 'string' ? item.title.trim().slice(0, 80) : '';
      const date = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        ? item.date
        : undefined;
      const recurrence = item.recurrence;
      if (!title || (recurrence != null && !['daily', 'weekly', 'monthly'].includes(String(recurrence)))) continue;
      const threadTitle = typeof item.threadTitle === 'string' && activeTitles.has(item.threadTitle)
        ? item.threadTitle
        : undefined;
      const key = `${title}|${date ?? ''}|${recurrence ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({
        title,
        ...(date ? { date } : {}),
        ...(recurrence ? { recurrence: recurrence as TaskIntent['recurrence'] } : {}),
        ...(threadTitle ? { threadTitle } : {}),
      });
    }
    return tasks;
  }

  private hydrateTaskUpdates(rawUpdates: unknown, snapshot: ChatSnapshot): TaskUpdateIntent[] {
    if (!Array.isArray(rawUpdates)) return [];
    const taskTitles = snapshot.tasks.filter((task) => task.status === 'todo').map((task) => task.title);
    const activeTitles = new Set(snapshot.threads.filter((thread) => thread.status === 'active').map((thread) => thread.title));
    const updates: TaskUpdateIntent[] = [];
    const seen = new Set<string>();
    for (const raw of rawUpdates.slice(0, 2)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const taskTitle = typeof item.taskTitle === 'string' ? item.taskTitle.trim().slice(0, 80) : '';
      const newThreadTitle = typeof item.newThreadTitle === 'string' ? item.newThreadTitle.trim() : '';
      const matches = taskTitles.filter((title) => title === taskTitle || title.includes(taskTitle) || taskTitle.includes(title));
      if (!taskTitle || matches.length !== 1 || !activeTitles.has(newThreadTitle)) continue;
      const key = `${matches[0]}|${newThreadTitle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      updates.push({ taskTitle: matches[0], newThreadTitle });
    }
    return updates;
  }

  // ── 主入口 ──────────────────────────────────

  async process(input: string, snapshot: ChatSnapshot): Promise<AgentOutput> {
    const analysis = analyzeState(snapshot.states, snapshot.tasks, snapshot.memories);
    const intent = await this.classifyIntent(input);
    console.log(`[SuperAgent] intent=${intent} rule=${analysis.rule} diagnosis=${analysis.diagnosis}`);

    const system = [
      PERSONA,
      SPECIALIST_PROMPTS[intent],
      this.buildContextBlock(snapshot, analysis),
      OUTPUT_CONTRACT,
    ].join('\n\n---\n\n');

    const messages: LLMMessage[] = [
      { role: 'system', content: system },
      ...this.buildHistory(snapshot.chatMessages),
      { role: 'user', content: input },
    ];

    // deepseek-v4-flash 有概率返回空/截断内容（实测 outputTokens 个位数），重试最多 3 次，逐次降温
    // 注意：截断的 JSON 会让 chatJSON 直接抛异常，必须在循环内捕获，否则一次失败就逃逸到规则兜底
    let reply = '';
    let lastResult: { reply?: string; actions?: unknown; taskIntents?: unknown; taskUpdates?: unknown } = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        lastResult = await this.llm.chatJSON<{ reply?: string; actions?: unknown; taskIntents?: unknown; taskUpdates?: unknown }>(
          messages,
          { temperature: 0.6 - attempt * 0.2, maxTokens: 1500, task: `specialist:${intent}` },
        );
        reply = (lastResult.reply ?? '').trim();
        if (reply.length >= 10) break;
        console.warn(`[SuperAgent] specialist:${intent} 第 ${attempt + 1} 次返回空/过短回复（${reply.length} 字），重试`);
      } catch (e) {
        console.warn(`[SuperAgent] specialist:${intent} 第 ${attempt + 1} 次调用异常（${(e as Error).message.slice(0, 80)}），重试`);
      }
    }
    if (!reply) throw new Error('LLM returned empty reply');

    return {
      reply,
      actions: this.hydrateActions(lastResult.actions, intent, analysis, snapshot),
      taskIntents: this.hydrateTaskIntents(lastResult.taskIntents, snapshot),
      taskUpdates: this.hydrateTaskUpdates(lastResult.taskUpdates, snapshot),
      intent,
      analysis,
    };
  }
}
