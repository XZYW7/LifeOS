/**
 * TodayPage：「今天」页（路由 /，原首页已合并进来）
 * ─────────────────────────────────────────────
 * 自上而下：
 * ① 页头：日期 / 连续天数 / 能量模式徽标 + 副标题「每天 30 秒打卡，剩下的交给系统」
 * ② 今日两步卡（TodayTwoSteps：打卡状态 + 手机随手记提示）
 * ③ 打卡区：CheckInForm / 已打卡状态条
 * ④ DreamCard：夜间归纳（server 离线时静默隐藏）
 * ⑤ TodayThreads：线程区（平铺全部 active 线程 + 待办勾选照顾 + /api/today-nudge 提醒）
 * ⑥ DimensionPanel：五维状态 · 近 7 天
 * ⑦ AgentReadingCard：规则引擎观察（取代原 ModeAnalysisCard）
 */
import { useState } from 'react';
import { PencilLine } from 'lucide-react';
import { useLifeOS, getTodayState, getAllStates, todayStr } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import CheckInForm from '@/components/today/CheckInForm';
import DreamCard from '@/components/today/DreamCard';
import TodayTwoSteps from '@/components/today/TodayTwoSteps';
import TodayThreads from '@/components/today/TodayThreads';
import DimensionPanel from '@/components/today/DimensionPanel';
import { AgentReadingCard } from '@/components/today/AgentReading';
import { MODE_META } from '@/components/today/meta';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 连续打卡天数（截至今天；今天未打则截至昨天） */
function checkInStreak(dates: string[]): number {
  const set = new Set(dates);
  const cursor = new Date();
  if (!set.has(todayStr())) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  for (;;) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    if (!set.has(`${y}-${m}-${day}`)) break;
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

export default function TodayPage() {
  const todayState = useLifeOS(getTodayState);
  const allStates = useLifeOS(useShallow(getAllStates));
  const currentMode = useLifeOS((s) => s.energyMode.current);
  const addDailyState = useLifeOS((s) => s.addDailyState);

  const [editing, setEditing] = useState(false);

  const now = new Date();
  const dateLabel = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · 周${WEEKDAYS[now.getDay()]}`;
  const streak = checkInStreak(allStates.map((s) => s.date));
  const modeMeta = MODE_META[currentMode];

  const showForm = !todayState || editing;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
      {/* ① 页头 */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">今天</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            每天 30 秒打卡，剩下的交给系统 · {dateLabel}
            {streak > 0 && (
              <span className="ml-2 font-data text-xs text-muted-foreground/80">
                已连续记录 {streak} 天
              </span>
            )}
          </p>
        </div>
        <div
          className={cn(
            'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
            modeMeta.ring,
            modeMeta.softBg,
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', modeMeta.dot)} />
          <span className="text-muted-foreground">当前</span>
          <span className="font-medium text-foreground">{modeMeta.label}</span>
        </div>
      </header>

      {/* ② 今日两步 */}
      <TodayTwoSteps />

      {/* ③ 打卡区 */}
      {showForm ? (
        <div>
          <CheckInForm
            onSubmit={(state) => {
              addDailyState(state);
              setEditing(false);
            }}
          />
          {editing && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground"
            >
              取消修改
            </button>
          )}
        </div>
      ) : (
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-5 py-4">
          <span className="text-xs text-muted-foreground">今日打卡</span>
          {todayState.source === 'auto' && (
            <span className="rounded-full border border-olive/40 bg-olive/10 px-2.5 py-1 text-[11px] text-olive">
              自动记录 · 点修改可改
            </span>
          )}
          <span className="rounded-full border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs text-brand">
            能量 · {todayState.energy === 'high' ? '充沛' : todayState.energy === 'medium' ? '一般' : '低'}
          </span>
          {([todayState.body, todayState.emotion, todayState.social, todayState.creative, todayState.learning] as const).map(
            (d, i) => (
              <span key={i} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                {['身体', '情绪', '社交', '创造', '学习'][i]} · {d.tag}
              </span>
            ),
          )}
          {todayState.note && (
            <span className="w-full pt-1 text-xs text-muted-foreground/80">「{todayState.note}」</span>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <PencilLine className="h-3 w-3" strokeWidth={1.8} />
            修改
          </button>
        </section>
      )}

      {/* ④ Dream 夜间归纳（server 离线时静默隐藏） */}
      <DreamCard />

      {/* ⑤ 线程区：平铺全部 active 线程，勾选待办 = 照顾 */}
      <TodayThreads />

      {/* ⑥ 五维状态面板 */}
      <DimensionPanel />

      {/* ⑦ Agent 观察 */}
      <AgentReadingCard />
    </div>
  );
}
