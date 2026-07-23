/**
 * 「今天」页 · 今日两步卡
 * 每天只需要做这两件事，其余交给系统：
 * ① 30 秒打卡（下方表单）；② 手机随手记（/capture）。
 * 迁移自原首页 HomePage 的「今天只需两步」区块。
 */
import { Link } from 'react-router-dom';
import { useLifeOS, getTodayState } from '@/lib/store';

export default function TodayTwoSteps() {
  const todayState = useLifeOS(getTodayState);

  return (
    <section className="rounded-lg border border-border bg-card px-5 py-4">
      <div className="font-data text-[11px] tracking-widest text-muted-foreground">
        今天只需两步
      </div>
      <div className="mt-3 space-y-2.5 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground">①</span>
          {todayState ? (
            <span className="text-muted-foreground">
              今日打卡
              <span className="ml-2 text-xs text-muted-foreground/70">已打卡 ✓</span>
            </span>
          ) : (
            <span className="text-foreground">
              今日打卡
              <span className="ml-2 text-xs text-muted-foreground">
                下方用 30 秒告诉系统你今天的电量
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground">②</span>
          <span className="text-foreground">
            <Link
              to="/capture"
              className="font-medium text-brand underline decoration-brand/40 underline-offset-4 transition-colors hover:decoration-brand"
            >
              随手记：有想法就扔进来 →
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">
              同一 WiFi 下手机打开 {window.location.origin}/capture
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
