/**
 * LifeOS Agent 规则引擎（纯函数，可单测，零 LLM 依赖）
 * ─────────────────────────────────────────────────────────────
 * 实现 design/04-ai-agent.md 的 R1-R5 决策表：
 *   R1 连续高强度 ≥ 4 天 且 今日能量低        → 恢复需求（高置信，短路）
 *   R2 近 3 天睡眠均值 < 6h 且 疲劳关键词     → 恢复需求（高置信，短路）
 *   R3 能量正常 但 目标相关任务连续搁置 + 意义缺失关键词 → 动力不足
 *   R4 能量低 但 负荷不高、睡眠正常、无躯体关键词     → 情绪性低落
 *   R5 其余                                   → 常规日
 * 冲突处理：恢复需求优先级最高（R1/R2 命中即短路）。
 * 回复风格：观察（数据）→ 归因（可证伪）→ 建议（动作），不空洞安慰。
 */

import type {
  AgentAnalysis, ChatContext, ChatResult, DailyState, EnergyLevel,
  Goal, MemoryEntry, Task, TodayPlan,
} from '@/types';
import { todayStr, uid, USER_ID } from './store';

// ── 关键词表 ──────────────────────────────────

const TIRED_KW = /累|疲惫|撑不住|头痛|没睡好|状态差|不想动|精疲力尽|透支/;
const EMPTY_KW = /没意义|迷茫|不想做|烦躁|拖延|刷手机|提不起劲/;
const DOUBT_KW = /方向|不适合|怀疑|放弃|要不要继续|走错/;
const REVIEW_KW = /总结|复盘|最近怎么样|状态如何|回顾/;

// ── 内部工具 ──────────────────────────────────

const ENERGY_NUM: Record<EnergyLevel, number> = { high: 4, medium: 3, low: 1 };

function sorted(states: DailyState[]): DailyState[] {
  return [...states].sort((a, b) => a.date.localeCompare(b.date));
}

function nextDay(from: string): string {
  const d = new Date(from + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 连续高强度天数（从昨日向前数） */
function countConsecutiveHighLoad(states: DailyState[]): number {
  const today = todayStr();
  let count = 0;
  for (let i = states.length - 1; i >= 0; i--) {
    const st = states[i];
    if (st.date === today) continue;
    if (st.energy === 'high') count++;
    else break;
  }
  return count;
}

/** 近 3 天睡眠均值（无数据返回 null） */
function avgSleep3d(states: DailyState[]): number | null {
  const recent = states.slice(-3).filter((s) => s.sleepHours != null);
  if (recent.length === 0) return null;
  return recent.reduce((sum, s) => sum + (s.sleepHours ?? 0), 0) / recent.length;
}

/** 目标相关任务连续搁置天数（能量正常却被跳过，选择性回避信号） */
function goalTaskMissStreak(states: DailyState[], tasks: Task[]): number {
  let streak = 0;
  for (let i = states.length - 1; i >= 0; i--) {
    const st = states[i];
    if (st.date === todayStr()) continue;
    const dayTasks = tasks.filter((t) => t.date === st.date && t.goalId);
    if (dayTasks.length === 0) break;
    const hasSkipped = dayTasks.some((t) => t.status === 'skipped');
    const hasDone = dayTasks.some((t) => t.status === 'done');
    if (hasSkipped && !hasDone) streak++;
    else break;
  }
  return streak;
}

// ── analyzeState ──────────────────────────────────

export function analyzeState(
  states: DailyState[],
  tasks: Task[],
  memories: MemoryEntry[],
): AgentAnalysis {
  const list = sorted(states);
  const today = list[list.length - 1];
  const highLoadDays = countConsecutiveHighLoad(list);
  const sleep3d = avgSleep3d(list);
  const missStreak = goalTaskMissStreak(list, tasks);

  const patterns: string[] = [];
  if (highLoadDays >= 3) patterns.push(`连续高强度工作 ${highLoadDays} 天`);
  if (sleep3d != null && sleep3d < 6.5) patterns.push(`近 3 天睡眠均值 ${sleep3d.toFixed(1)}h，低于恢复线 6.5h`);
  if (missStreak >= 2) patterns.push(`目标相关任务连续 ${missStreak} 天被搁置`);

  const activePatterns = memories.filter((m) => m.kind === 'pattern' && m.active && !m.superseded);
  const historyHint = activePatterns.length > 0 ? activePatterns[0].content : null;

  if (!today) {
    return {
      rule: 'R5', diagnosis: 'normal', confidence: '—', evidence: '暂无状态记录',
      suggestedMode: 'medium', reasoning: '还没有任何状态记录，先完成今日打卡再分析。',
      patterns, consecutiveHighLoadDays: 0,
    };
  }

  const note = `${today.note ?? ''} ${today.body.note ?? ''} ${today.emotion.note ?? ''}`;
  const energyNum = ENERGY_NUM[today.energy];

  // R1：连续高强度 ≥ 4 天 且 能量低 → 恢复需求
  if (highLoadDays >= 4 && energyNum <= 2) {
    const evidence = `连续 ${highLoadDays} 天高负荷 + 今日能量${today.energy === 'low' ? '低' : '中'}`;
    return {
      rule: 'R1', diagnosis: 'recovery', confidence: 'high', evidence,
      suggestedMode: 'low',
      reasoning:
        `观察：你已连续高强度工作 ${highLoadDays} 天，今天能量自评为低` +
        (sleep3d != null ? `，近 3 天睡眠均值 ${sleep3d.toFixed(1)}h` : '') +
        `。\n归因：这更像恢复需求，不是动力不足` +
        (historyHint ? `——你的历史记录里有一条已确认的规律："${historyHint}"` : '') +
        `。\n建议：今天进入省电模式，砍量但保留与长期目标的最小连接。如果你觉得判断不对，可以纠正我。`,
      patterns, consecutiveHighLoadDays: highLoadDays,
    };
  }

  // R2：睡眠 3 日均值 < 6h 且 疲劳关键词 → 恢复需求
  if (sleep3d != null && sleep3d < 6 && TIRED_KW.test(note)) {
    return {
      rule: 'R2', diagnosis: 'recovery', confidence: 'high',
      evidence: `近 3 天睡眠均值 ${sleep3d.toFixed(1)}h + 疲劳关键词`,
      suggestedMode: 'low',
      reasoning:
        `观察：近 3 天睡眠均值只有 ${sleep3d.toFixed(1)}h，你的描述里出现了疲劳信号。\n` +
        `归因：身体在要账了——这是恢复需求，继续加压只会把低能量日变成停摆日。\n` +
        `建议：省电模式，今晚唯一的目标是睡够 7 小时。`,
      patterns, consecutiveHighLoadDays: highLoadDays,
    };
  }

  // R3：能量正常 但 目标相关任务连续搁置 + 意义缺失关键词 → 动力不足
  if (energyNum >= 3 && missStreak >= 3 && EMPTY_KW.test(note)) {
    return {
      rule: 'R3', diagnosis: 'motivation', confidence: 'medium',
      evidence: `能量正常但目标相关任务连续 ${missStreak} 天未完成`,
      suggestedMode: 'medium',
      reasoning:
        `观察：你的能量和睡眠都在正常区间，身体没有问题；但目标相关任务已连续 ${missStreak} 天被搁置，而其他任务照做。\n` +
        `归因：这是选择性回避，不是需要休息——通常意味着任务粒度太大，或和长期目标的连接感变弱了。\n` +
        `建议：不休息，而是把目标任务拆小到今天 15 分钟能启动的尺寸。如果你其实是对方向本身产生了怀疑，我们也可以聊那个。`,
      patterns, consecutiveHighLoadDays: highLoadDays,
    };
  }

  // R4：能量低 但 负荷不高、睡眠正常、无躯体关键词 → 情绪性低落
  if (energyNum <= 2 && highLoadDays < 3 && (sleep3d == null || sleep3d >= 6.5) && !TIRED_KW.test(note)) {
    return {
      rule: 'R4', diagnosis: 'emotional_low', confidence: 'medium',
      evidence: '负荷与睡眠正常，但能量自评低',
      suggestedMode: 'medium',
      reasoning:
        `观察：最近负荷不高、睡眠也正常，但你的能量自评偏低。\n` +
        `归因：这不像身体枯竭，更像情绪性低落。我不确定来源是什么——也许是目标之外的什么事。\n` +
        `建议：今天按平衡模式走，不加压也不强行打鸡血。如果你愿意，可以说说发生了什么，我会记住。`,
      patterns, consecutiveHighLoadDays: highLoadDays,
    };
  }

  // R5：常规日
  return {
    rule: 'R5', diagnosis: 'normal', confidence: '—', evidence: '',
    suggestedMode: energyNum >= 4 ? 'high' : energyNum <= 2 ? 'low' : 'medium',
    reasoning:
      `观察：今日能量${today.energy === 'high' ? '高' : today.energy === 'medium' ? '中等' : '偏低'}，` +
      `近 3 天睡眠均值 ${sleep3d != null ? sleep3d.toFixed(1) + 'h' : '无记录'}，无异常模式。\n` +
      `归因：常规波动，无需干预。\n建议：按能量匹配模式推进即可。`,
    patterns, consecutiveHighLoadDays: highLoadDays,
  };
}

// ── generateTodayPlan ──────────────────────────────────

/** 找到任务沿 goal 链向上到达的 year/vision 层根目标 id */
function rootGoalId(task: Task, goals: Goal[]): string | null {
  if (!task.goalId) return null;
  const byId = new Map(goals.map((g) => [g.id, g]));
  let cur = byId.get(task.goalId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if ((cur.scale === 'year' || cur.scale === 'vision') || !cur.parentId) return cur.id;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return null;
}

export function generateTodayPlan(
  analysis: AgentAnalysis,
  goals: Goal[],
  tasks: Task[],
): TodayPlan {
  const today = todayStr();
  const tomorrow = nextDay(today);
  const todayTasks = tasks.filter((t) => t.kind !== 'longterm' && t.date === today && t.status !== 'done');
  const mode = analysis.suggestedMode;

  if (mode === 'low') {
    // 省电模式：维持性任务 ≤ 2 + 每个根目标一个最小连接行动，其余顺延
    const maintenance = todayTasks.filter((t) => t.isMaintenance).slice(0, 2);
    const alreadyMinimal = todayTasks.filter((t) => t.isMinimalConnection);
    const kept = [...maintenance, ...alreadyMinimal];
    const keptIds = new Set(kept.map((t) => t.id));
    const rest = todayTasks.filter((t) => !keptIds.has(t.id));

    // 为每个有任务被顺延的根目标生成最小连接行动（≤15min）
    const minimalConnections: Task[] = [];
    const coveredRoots = new Set<string>();
    for (const t of alreadyMinimal) {
      const root = rootGoalId(t, goals);
      if (root) coveredRoots.add(root);
    }
    for (const t of rest) {
      const root = rootGoalId(t, goals);
      if (!root || coveredRoots.has(root)) continue;
      coveredRoots.add(root);
      minimalConnections.push({
        id: uid('task-min'),
        userId: USER_ID,
        title: `（最小连接）${t.title.length > 18 ? t.title.slice(0, 18) + '…' : t.title} · 15 分钟轻量版`,
        goalId: t.goalId,
        projectId: t.projectId,
        energyCost: 'low',
        status: 'todo',
        date: today,
        isMinimalConnection: true,
      });
    }

    const deferredTasks = rest.map((t) => ({
      ...t,
      deferredTo: tomorrow,
      deferReason: analysis.diagnosis,
    }));

    return {
      date: today,
      mode,
      keptTasks: kept,
      deferredTasks,
      minimalConnections,
      note:
        `省电模式：只保留 ${kept.length + minimalConnections.length} 件事（含维持性任务与长期目标的最小连接），` +
        `其余 ${deferredTasks.length} 项顺延到明天。顺延不是失败，不计入断档。`,
    };
  }

  if (analysis.diagnosis === 'motivation') {
    // 动力不足：不砍量，目标相关任务拆细前置（置顶）
    const goalTasks = todayTasks.filter((t) => t.goalId);
    const others = todayTasks.filter((t) => !t.goalId);
    return {
      date: today,
      mode,
      keptTasks: [...goalTasks, ...others],
      deferredTasks: [],
      minimalConnections: [],
      note: '目标相关任务已前置。建议把第一件拆到 15 分钟能启动的尺寸，先启动再说。',
    };
  }

  if (mode === 'high') {
    return {
      date: today,
      mode,
      keptTasks: todayTasks,
      deferredTasks: [],
      minimalConnections: [],
      note: '高性能模式：全量推进，重任务优先。可以加一件有挑战的事，但注意别透支明天的自己。',
    };
  }

  // medium：保留约 80%（砍掉的按高消耗优先顺延）
  const sortedByCost = [...todayTasks].sort((a, b) => {
    const order = { high: 2, medium: 1, low: 0 };
    return order[b.energyCost] - order[a.energyCost];
  });
  const keepCount = Math.max(1, Math.ceil(todayTasks.length * 0.8));
  const keptTasks = sortedByCost.slice(0, keepCount);
  const deferredTasks = sortedByCost.slice(keepCount).map((t) => ({
    ...t,
    deferredTo: tomorrow,
    deferReason: 'balance',
  }));
  return {
    date: today,
    mode,
    keptTasks,
    deferredTasks,
    minimalConnections: [],
    note: deferredTasks.length > 0
      ? `平衡模式：推进 ${keptTasks.length} 件，${deferredTasks.length} 件低优先级顺延。`
      : '平衡模式：正常推进。',
  };
}

// ── chat ──────────────────────────────────

export function chat(input: string, context: ChatContext): ChatResult {
  const { user, states, tasks, goals, memories } = context;
  const text = input.trim();
  const analysis = analyzeState(states, tasks, memories);
  const vision = goals.find((g) => g.scale === 'year' || g.scale === 'vision');

  // 1) 方向怀疑：冻结计划，开放式对话（规则引擎边界，示例 3）
  if (DOUBT_KW.test(text)) {
    const recentInsight = memories.find((m) => m.kind === 'insight' && m.active && !m.superseded);
    return {
      reply:
        `明白了——这不像疲惫，是方向感的问题，比疲惫重要得多。\n` +
        (recentInsight ? `我先把之前"${recentInsight.content.slice(0, 24)}…"这条判断挂起，避免用旧归因解释新问题。\n` : '') +
        `在调整计划之前我想先搞清楚两件事：① 这种怀疑是这几天才出现的，还是更早就开始了？② 你怀疑的是"${vision?.title ?? '当前方向'}"这个领域，还是怀疑通往它的这条路径？\n` +
        `你可以随便说，我今天不给任何任务建议，今日计划已冻结。`,
      actions: [{ type: 'freeze_plan', label: '冻结今日计划（不做自动重排）', reason: 'direction_doubt' }],
    };
  }

  // 2) 疲劳信号：走 R1/R2 恢复需求链路
  if (TIRED_KW.test(text)) {
    if (analysis.diagnosis === 'recovery') {
      const plan = generateTodayPlan(analysis, goals, tasks);
      return {
        reply: `${analysis.reasoning}\n我已按省电模式拟好今日调整：${plan.note}`,
        actions: [
          { type: 'apply_plan', label: `应用省电模式调整（${plan.keptTasks.length + plan.minimalConnections.length} 件保留 / ${plan.deferredTasks.length} 件顺延）`, plan, mode: 'low' },
        ],
      };
    }
    return {
      reply:
        `观察：你说累，但数据里连续高强度只有 ${analysis.consecutiveHighLoadDays} 天，` +
        `睡眠和负荷都还在正常区间，没有命中恢复需求的条件。\n` +
        `归因：这可能是一日内的波动，而不是系统性透支。我对此只有中等把握。\n` +
        `建议：按平衡模式走，把最重的那件任务降一档再做。如果到明天还觉得累，告诉我，我会重新评估。`,
    };
  }

  // 3) 意义缺失 / 回避信号：R3 动力不足链路
  if (EMPTY_KW.test(text)) {
    if (analysis.diagnosis === 'motivation') {
      const plan = generateTodayPlan(analysis, goals, tasks);
      return {
        reply: `${analysis.reasoning}\n目标相关任务已前置：${plan.note}`,
        actions: [{ type: 'apply_plan', label: '应用"拆小前置"调整', plan, mode: 'medium' }],
      };
    }
    return {
      reply:
        `观察：你提到"${text.slice(0, 12)}"，但最近目标相关任务的完成记录还没有形成连续搁置的模式。\n` +
        `归因：单日的抵触不等于动力不足，可能只是这件任务的启动成本太高。\n` +
        `建议：今天只要求自己启动 15 分钟——读一段摘要、写三行笔记都算。启动之后要不要继续，交给当时的你决定。`,
    };
  }

  // 4) 复盘请求
  if (REVIEW_KW.test(text)) {
    const recent = sorted(states).slice(-7);
    const highDays = recent.filter((s) => s.energy === 'high').length;
    const lowDays = recent.filter((s) => s.energy === 'low').length;
    const patternMem = memories.find((m) => m.kind === 'pattern' && m.active && !m.superseded);
    return {
      reply:
        `近 7 天复盘：高强度 ${highDays} 天，低能量 ${lowDays} 天；当前能量模式为「${{ high: '高性能', medium: '平衡', low: '省电' }[user.currentEnergyMode]}」。\n` +
        (patternMem ? `已确认的模式："${patternMem.content}"。\n` : '') +
        `${analysis.diagnosis === 'recovery' ? '⚠️ 当前命中恢复需求信号，建议今天降档。' : '整体在可控区间，按当前模式继续即可。'}`,
    };
  }

  // 5) 默认：状态摘要 + 邀请
  return {
    reply:
      `我看到的你：${analysis.reasoning.split('\n')[0].replace('观察：', '')}\n` +
      `你可以告诉我今天的真实状态（累/卡住/迷茫都行），我会结合历史记录判断是恢复需求还是动力不足，再决定要不要动你的计划。`,
  };
}

// ── generateInsight ──────────────────────────────────

/** 从近期状态提炼模式记忆；无可信模式时返回 null */
export function generateInsight(states: DailyState[]): MemoryEntry | null {
  const list = sorted(states);
  if (list.length < 6) return null;

  const highLoadDays = countConsecutiveHighLoad(list);
  const today = list[list.length - 1];

  // 模式：连续高强度后崩塌
  if (highLoadDays >= 4 && today.energy === 'low') {
    const sourceRefs = list.slice(-(highLoadDays + 1)).map((s) => s.id);
    return {
      id: uid('mem'),
      userId: USER_ID,
      kind: 'pattern',
      content: `连续高强度 ${highLoadDays} 天后能量降至低位——又一次验证了"冲刺后必崩"的节律，下次第 3 天就该主动降档`,
      sourceRefs,
      confidence: highLoadDays >= 5 ? 'high' : 'medium',
      superseded: false,
      active: true,
      firstSeenAt: today.date,
      lastConfirmedAt: today.date,
    };
  }

  // 模式：睡眠与创造力相关
  const recent = list.slice(-7).filter((s) => s.sleepHours != null);
  if (recent.length >= 5) {
    const goodSleep = recent.filter((s) => (s.sleepHours ?? 0) >= 7);
    const badSleep = recent.filter((s) => (s.sleepHours ?? 0) < 6.5);
    const avgCreative = (arr: DailyState[]) =>
      arr.reduce((sum, s) => sum + (s.creative.level ?? 3), 0) / Math.max(arr.length, 1);
    if (goodSleep.length >= 2 && badSleep.length >= 2 && avgCreative(goodSleep) - avgCreative(badSleep) >= 1) {
      return {
        id: uid('mem'),
        userId: USER_ID,
        kind: 'insight',
        content: '近 7 天数据：睡眠 ≥ 7h 的日子创造力明显更高，睡眠是最值得优先保护的杠杆',
        sourceRefs: recent.map((s) => s.id),
        confidence: 'medium',
        superseded: false,
        active: true,
        firstSeenAt: today.date,
        lastConfirmedAt: today.date,
      };
    }
  }

  return null;
}
