/**
 * LifeOS 合成演示种子数据（虚构资料，不代表真实用户）
 * ─────────────────────────────────────────────────────────────
 * 用户"林澈"，愿景"成为 3D AI 研究者"。
 * 包含完整 vision→year→month→week→today 目标链、
 * 最近 10 天有叙事弧线的 DailyState（恢复→回升→连续 5 天高强度→今日崩塌，
 * 用于演示 Agent R1"恢复需求"判定）、2 条 LifeVersion、记忆与预置对话。
 * 日期在首次启动时相对"今天"动态生成。
 */

import type {
  User, Vision, Goal, Project, DailyState, EnergyMode, Task,
  LifeVersion, MemoryEntry, KnowledgeItem, ChatMessage, DimensionState, EnergyLevel,
} from '@/types';

export const USER_ID = 'user-linche';

// ── 日期工具 ──────────────────────────────────

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoWeekLabel(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const dim = (tag: string, level: 1 | 2 | 3 | 4 | 5, note?: string): DimensionState => ({ tag, level, note });

// ── 种子构建 ──────────────────────────────────

export interface SeedData {
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
}

export function buildSeed(): SeedData {
  const now = new Date().toISOString();
  const today = fmt(new Date());
  const yearPeriod = String(new Date().getFullYear());
  const monthPeriod = today.slice(0, 7);
  const weekPeriod = isoWeekLabel(new Date());

  // ── 用户 ──
  const user: User = {
    id: USER_ID,
    name: '林澈',
    createdAt: fmt(daysAgo(40)) + 'T09:00:00.000Z',
    currentEnergyMode: 'medium',
    lifeStageTag: '探索期',
    settings: { timezone: 'Asia/Shanghai', checkInReminderTime: '21:30' },
  };

  // ── 愿景 ──
  const vision: Vision = {
    id: 'vision-3d-ai',
    userId: USER_ID,
    title: '成为 3D AI 研究者',
    narrative:
      '过去两年做前端让我确认了一件事：我最兴奋的时刻都和"把三维世界搬进计算机"有关。' +
      '3D 生成与重建正在从实验室走向产品，我想站在研究一侧，做出能写进论文也能落地 Demo 的工作。',
    horizon: '3y',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  // ── 目标链：vision → year → month → week → day ──
  const goals: Goal[] = [
    {
      id: 'goal-year-paper',
      userId: USER_ID,
      scale: 'year',
      title: `${yearPeriod}：发表 1 篇 workshop 论文`,
      visionId: vision.id,
      period: yearPeriod,
      status: 'active',
      createdAt: now,
    },
    {
      id: 'goal-month-nerf',
      userId: USER_ID,
      scale: 'month',
      title: `${monthPeriod}：完成 NeRF 复现 + baseline 结果`,
      parentId: 'goal-year-paper',
      period: monthPeriod,
      status: 'active',
      createdAt: now,
    },
    {
      id: 'goal-month-portfolio',
      userId: USER_ID,
      scale: 'month',
      title: `${monthPeriod}：作品集网站 v1 上线`,
      parentId: 'goal-year-paper',
      period: monthPeriod,
      status: 'active',
      createdAt: now,
    },
    {
      id: 'goal-week-train',
      userId: USER_ID,
      scale: 'week',
      title: `${weekPeriod}：跑通 nerfstudio 官方训练流程`,
      parentId: 'goal-month-nerf',
      period: weekPeriod,
      status: 'active',
      createdAt: now,
    },
    {
      id: 'goal-day-setup',
      userId: USER_ID,
      scale: 'day',
      title: `${today}：环境配置 + 数据集校验`,
      parentId: 'goal-week-train',
      period: today,
      status: 'active',
      createdAt: now,
    },
  ];

  // ── 项目 ──
  const projects: Project[] = [
    {
      id: 'proj-nerf',
      userId: USER_ID,
      title: 'NeRF 复现实验',
      goalIds: ['goal-month-nerf', 'goal-year-paper'],
      status: 'active',
      outputLinks: ['github.com/linche/nerf-repro'],
      createdAt: now,
    },
    {
      id: 'proj-portfolio',
      userId: USER_ID,
      title: '个人作品集网站',
      goalIds: ['goal-month-portfolio'],
      status: 'active',
      createdAt: now,
    },
  ];

  // ── 今日任务 ──
  const tasks: Task[] = [
    {
      id: 'task-deps',
      userId: USER_ID,
      title: '安装 nerfstudio 依赖并验证 CUDA 环境',
      goalId: 'goal-day-setup',
      projectId: 'proj-nerf',
      energyCost: 'high',
      status: 'todo',
      date: today,
    },
    {
      id: 'task-dataset',
      userId: USER_ID,
      title: '下载并校验 blender lego 数据集',
      goalId: 'goal-day-setup',
      projectId: 'proj-nerf',
      energyCost: 'medium',
      status: 'todo',
      date: today,
    },
    {
      id: 'task-paper',
      userId: USER_ID,
      title: '读 3DGS 论文 Abstract + 图 1（15 分钟）',
      goalId: 'goal-day-setup',
      projectId: 'proj-nerf',
      energyCost: 'low',
      status: 'todo',
      date: today,
      isMinimalConnection: true,
    },
    {
      id: 'task-notes',
      userId: USER_ID,
      title: '整理实验笔记',
      goalId: 'goal-day-setup',
      energyCost: 'low',
      status: 'todo',
      date: today,
      isMaintenance: true,
    },
    {
      id: 'task-walk',
      userId: USER_ID,
      title: '散步 20 分钟',
      energyCost: 'low',
      status: 'todo',
      date: today,
      isMaintenance: true,
    },
    // 过去几天的任务痕迹（供模式判定使用）
    {
      id: 'task-past-1',
      userId: USER_ID,
      title: '跑通 instant-ngp demo',
      goalId: 'goal-week-train',
      projectId: 'proj-nerf',
      energyCost: 'high',
      status: 'done',
      date: fmt(daysAgo(3)),
    },
    {
      id: 'task-past-2',
      userId: USER_ID,
      title: '整理 NeRF 系列论文对比表',
      goalId: 'goal-week-train',
      projectId: 'proj-nerf',
      energyCost: 'medium',
      status: 'done',
      date: fmt(daysAgo(2)),
    },
    {
      id: 'task-past-3',
      userId: USER_ID,
      title: '读 3DGS 论文方法章节',
      goalId: 'goal-week-train',
      projectId: 'proj-nerf',
      energyCost: 'medium',
      status: 'skipped',
      date: fmt(daysAgo(1)),
      deferReason: 'overload',
    },
  ];

  // ── 最近 10 天 DailyState：恢复 → 回升 → 连续 5 天高强度 → 今日崩塌 ──
  const arc: Array<{
    offset: number;
    energy: EnergyLevel;
    body: DimensionState;
    emotion: DimensionState;
    social: DimensionState;
    creative: DimensionState;
    learning: DimensionState;
    sleepHours: number;
    note?: string;
  }> = [
    {
      offset: 9, energy: 'low', sleepHours: 8,
      body: dim('缓慢恢复', 2), emotion: dim('平静', 3), social: dim('低功耗', 2),
      creative: dim('停滞', 2), learning: dim('轻量输入', 2),
      note: '上个冲刺后的休息日，睡了很久。',
    },
    {
      offset: 8, energy: 'medium', sleepHours: 7.5,
      body: dim('恢复中', 3), emotion: dim('平稳', 3), social: dim('低功耗', 2),
      creative: dim('萌芽', 3), learning: dim('正常', 3),
    },
    {
      offset: 7, energy: 'medium', sleepHours: 7.5,
      body: dim('状态回升', 3), emotion: dim('平稳偏积极', 4), social: dim('适度', 3),
      creative: dim('有想法', 3), learning: dim('高效吸收', 4),
      note: '重新开始看 3DGS，感觉能跟上了。',
    },
    {
      offset: 6, energy: 'medium', sleepHours: 7,
      body: dim('良好', 4), emotion: dim('积极', 4), social: dim('适度', 3),
      creative: dim('进入状态', 4), learning: dim('高效吸收', 4),
    },
    // 连续 5 天高强度开始（d-5 ~ d-1）
    {
      offset: 5, energy: 'high', sleepHours: 7,
      body: dim('良好', 4), emotion: dim('兴奋', 4), social: dim('低功耗', 2),
      creative: dim('心流', 4), learning: dim('高效吸收', 4),
      note: '跑通 instant-ngp，太爽了。',
    },
    {
      offset: 4, energy: 'high', sleepHours: 6.5,
      body: dim('轻微疲劳', 3), emotion: dim('兴奋', 5), social: dim('低功耗', 2),
      creative: dim('心流频发', 5), learning: dim('高效吸收', 5),
    },
    {
      offset: 3, energy: 'high', sleepHours: 6.5,
      body: dim('疲劳积累', 3), emotion: dim('高张力', 4), social: dim('几乎为零', 1),
      creative: dim('心流', 4), learning: dim('正常', 4),
      note: '凌晨一点才睡，但不想停。',
    },
    {
      offset: 2, energy: 'high', sleepHours: 6,
      body: dim('恢复不足', 2), emotion: dim('平稳偏低', 3), social: dim('几乎为零', 1),
      creative: dim('心流频发', 5), learning: dim('正常', 3),
    },
    {
      offset: 1, energy: 'high', sleepHours: 5.5,
      body: dim('恢复不足', 2), emotion: dim('烦躁', 2), social: dim('几乎为零', 1),
      creative: dim('硬撑输出', 3), learning: dim('读不进去', 2),
      note: '论文方法章节完全读不动，先搁置了。',
    },
    // 今日：崩塌点（R1 演示）
    {
      offset: 0, energy: 'low', sleepHours: 5.5,
      body: dim('透支', 1, '头痛，眼睛酸'), emotion: dim('撑不住', 2), social: dim('不想说话', 1),
      creative: dim('枯竭', 1), learning: dim('无法集中', 1),
      note: '今天很累，什么都不想做。',
    },
  ];

  const dailyStates: Record<string, DailyState> = {};
  for (const s of arc) {
    const date = fmt(daysAgo(s.offset));
    dailyStates[date] = {
      id: `state-${date}`,
      userId: USER_ID,
      date,
      energy: s.energy,
      body: s.body,
      emotion: s.emotion,
      social: s.social,
      creative: s.creative,
      learning: s.learning,
      sleepHours: s.sleepHours,
      note: s.note,
    };
  }

  // ── 能量模式 ──
  const energyMode: EnergyMode = {
    userId: USER_ID,
    current: 'medium',
    effectiveFrom: fmt(daysAgo(9)),
    reason: '冲刺后进入平衡档，逐步回升',
    history: [
      { level: 'high', from: fmt(daysAgo(16)), to: fmt(daysAgo(10)), reason: 'instant-ngp 冲刺周' },
      { level: 'medium', from: fmt(daysAgo(9)), reason: '冲刺后进入平衡档，逐步回升' },
    ],
  };

  // ── 人生版本 ──
  const lifeVersions: LifeVersion[] = [
    {
      id: 'lv-2026-06',
      userId: USER_ID,
      version: '2026-06',
      date: fmt(daysAgo(21)),
      period: { from: fmt(daysAgo(51)), to: fmt(daysAgo(21)) },
      happened: ['完成 NeRF 原始论文精读', '正式决定从前端转向 3D AI 方向', '搭建第一个可渲染 demo'],
      gained: ['PyTorch 训练流程手感', 'volume rendering 直觉', '一个能跑的 demo'],
      released: ['"全栈工程师"的身份执念', '两个不再服务的 side project'],
      summary: '方向确认的月份。放弃了维护两年的旧项目，把全部业余精力收束到 3D AI。第一次体会到"放弃也是前进"。',
      statsSnapshot: { activeDays: 24, dominantEmotionTag: '积极', modeChanges: 2 },
      createdAt: now,
    },
    {
      id: 'lv-gap-v1',
      userId: USER_ID,
      version: 'gap-month-v1',
      date: fmt(daysAgo(6)),
      period: { from: fmt(daysAgo(20)), to: fmt(daysAgo(6)) },
      happened: ['开始 nerfstudio 复现', '作品集网站信息架构定稿'],
      gained: ['CUDA 环境排障经验', '论文对比表 × 6 篇'],
      released: ['日更博客的承诺', '"每天都要有产出"的强迫症'],
      summary: '学会与不完美产出共处。产出数量下降，但单点深度明显增加。',
      statsSnapshot: { activeDays: 13, dominantEmotionTag: '平稳', modeChanges: 1 },
      createdAt: now,
    },
  ];

  // ── 记忆 ──
  const highStateIds = arc.filter(a => a.energy === 'high').map(a => `state-${fmt(daysAgo(a.offset))}`);
  const memories: MemoryEntry[] = [
    {
      id: 'mem-fact-goal',
      userId: USER_ID,
      kind: 'fact',
      content: '长期目标：成为 3D AI 研究者（3 年 horizon）',
      sourceRefs: [vision.id],
      confidence: 'high',
      superseded: false,
      active: true,
      firstSeenAt: now,
      lastConfirmedAt: now,
    },
    {
      id: 'mem-fact-coffee',
      userId: USER_ID,
      kind: 'fact',
      content: '对咖啡因敏感，下午 2 点后喝咖啡会失眠',
      sourceRefs: [],
      confidence: 'medium',
      superseded: false,
      active: true,
      firstSeenAt: fmt(daysAgo(30)),
      lastConfirmedAt: fmt(daysAgo(12)),
    },
    {
      id: 'mem-pattern-crash',
      userId: USER_ID,
      kind: 'pattern',
      content: '连续高强度工作 4-5 天后能量必然下滑，且下滑前创造力往往处于峰值（容易误判为"还能继续"）',
      sourceRefs: highStateIds,
      confidence: 'medium',
      superseded: false,
      active: true,
      firstSeenAt: fmt(daysAgo(16)),
      lastConfirmedAt: today,
    },
    {
      id: 'mem-insight-sleep',
      userId: USER_ID,
      kind: 'insight',
      content: '创造力高峰与睡眠 ≥ 7h 强相关；睡眠 < 6.5h 的次日虽然情绪兴奋，但学习维度显著下降',
      sourceRefs: highStateIds.slice(0, 3),
      confidence: 'medium',
      superseded: false,
      active: true,
      firstSeenAt: fmt(daysAgo(10)),
      lastConfirmedAt: fmt(daysAgo(2)),
    },
  ];

  // ── 知识库 ──
  const knowledge: KnowledgeItem[] = [
    {
      id: 'kn-nerf-paper',
      userId: USER_ID,
      type: 'paper',
      title: 'NeRF 论文精读笔记',
      content: '# NeRF: Representing Scenes as Neural Radiance Fields\n\n核心：用 MLP 表示连续 5D 辐射场……',
      goalIds: ['goal-month-nerf'],
      projectIds: ['proj-nerf'],
      createdAt: fmt(daysAgo(18)),
    },
    {
      id: 'kn-3dgs-idea',
      userId: USER_ID,
      type: 'idea',
      title: '想法：3DGS 在移动端轻量化的可能切入点',
      content: '量化 + 剪枝之外，是否可以从采样策略入手……',
      goalIds: ['goal-year-paper'],
      projectIds: ['proj-nerf'],
      createdAt: fmt(daysAgo(4)),
    },
    {
      id: 'kn-log-cuda',
      userId: USER_ID,
      type: 'learning-log',
      title: 'CUDA 环境排障记录',
      content: 'tinycudann 编译失败 → 降级 gcc 到 11 解决……',
      goalIds: ['goal-week-train'],
      projectIds: ['proj-nerf'],
      createdAt: fmt(daysAgo(3)),
    },
  ];

  // ── 预置对话 ──
  const chatMessages: ChatMessage[] = [
    {
      id: 'chat-seed-1',
      userId: USER_ID,
      role: 'user',
      content: '这周感觉自己效率特别高，是不是可以再加一点任务？',
      createdAt: fmt(daysAgo(2)) + 'T13:20:00.000Z',
    },
    {
      id: 'chat-seed-2',
      userId: USER_ID,
      role: 'agent',
      content:
        '观察：你已连续 4 天处于高强度，创造维度确实处于峰值（心流频发），但身体维度从 4 降到 2，睡眠从 7h 降到 6h。\n' +
        '归因：这是典型的"高峰掩盖透支"模式——你的记忆库里有一条已确认两次的规律：连续高强度 4-5 天后能量必然下滑。\n' +
        '建议：不加任务。把今天的兴奋用在收尾和记录上，而不是开新的坑。',
      createdAt: fmt(daysAgo(2)) + 'T13:20:30.000Z',
    },
  ];

  return { user, visions: [vision], goals, projects, tasks, dailyStates, energyMode, lifeVersions, memories, knowledge, chatMessages };
}

// ── 空白档案 ──────────────────────────────────

/**
 * 构建"空白档案"：合法的最小结构，不注入任何演示内容。
 * 用于用户从种子数据切换到自己的真实数据。
 */
export function buildBlank(userName?: string): SeedData {
  const now = new Date().toISOString();
  const today = fmt(new Date());

  const user: User = {
    id: USER_ID,
    name: userName?.trim() || '我',
    createdAt: now,
    currentEnergyMode: 'medium',
    lifeStageTag: undefined,
    settings: { timezone: 'Asia/Shanghai' },
  };

  const energyMode: EnergyMode = {
    userId: USER_ID,
    current: 'medium',
    effectiveFrom: today,
    reason: '从空白档案开始',
    history: [{ level: 'medium', from: today, reason: '从空白档案开始' }],
  };

  return {
    user,
    visions: [],
    goals: [],
    projects: [],
    tasks: [],
    dailyStates: {},
    energyMode,
    lifeVersions: [],
    memories: [],
    knowledge: [],
    chatMessages: [],
  };
}
