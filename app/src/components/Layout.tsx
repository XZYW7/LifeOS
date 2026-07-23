/**
 * LifeOS App 外壳：左侧竖向导航 + 右侧内容区。
 * 5 个入口：今天（每天）/ 线程（每周）/ 对话（卡住时）/ 轨迹（每月）/ 设置（偶尔）。
 * 导航底部显示当前能量模式标识（取自全局 store）。
 */
import { NavLink, Outlet } from 'react-router-dom';
import { Sun, Waypoints, MessagesSquare, GitCommitHorizontal, Settings } from 'lucide-react';
import { useLifeOS } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { EnergyLevel } from '@/types';

const NAV_ITEMS = [
  { to: '/', label: '今天', icon: Sun, end: true, hint: '每天' },
  { to: '/threads', label: '线程', icon: Waypoints, hint: '每周' },
  { to: '/chat', label: '对话', icon: MessagesSquare, hint: '卡住时' },
  { to: '/trace', label: '轨迹', icon: GitCommitHorizontal, hint: '每月' },
  { to: '/settings', label: '设置', icon: Settings, hint: '偶尔' },
] as const;

const MODE_META: Record<EnergyLevel, { label: string; dot: string }> = {
  high: { label: '高性能', dot: 'bg-brand' },
  medium: { label: '平衡', dot: 'bg-olive' },
  low: { label: '省电', dot: 'bg-muted-foreground' },
};

export default function Layout() {
  const mode = useLifeOS((s) => s.energyMode.current);
  const userName = useLifeOS((s) => s.user.name);
  const meta = MODE_META[mode];

  return (
    <div className="h-viewport flex flex-col overflow-hidden bg-background text-foreground md:flex-row">
      {/* 左侧导航（≥768px 桌面端，移动端隐藏） */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-[hsl(var(--sidebar-background))] md:flex">
        <div className="px-5 pb-6 pt-6">
          <div className="font-data text-xl font-semibold tracking-wide text-brand">LifeOS</div>
          <div className="mt-1 text-xs text-muted-foreground">个人生命操作系统 · {userName}</div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon, hint, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-brand'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span className="flex min-w-0 flex-col">
                {label}
                <span className="text-[10px] leading-tight text-muted-foreground/60">{hint}</span>
              </span>
            </NavLink>
          ))}
        </nav>

        {/* 当前能量模式标识 */}
        <div className="border-t border-border px-5 py-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
            能量模式
            <span className="font-data text-foreground">{meta.label}</span>
          </div>
        </div>
      </aside>

      {/* 右侧内容区 */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* 底部 Tab Bar（<768px 移动端）：五个主页面，图标 + 短文案 + 频次小字提示 */}
      <nav
        className="shrink-0 border-t border-border bg-[hsl(var(--sidebar-background))] pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="主导航"
      >
        <div className="grid grid-cols-5">
          {NAV_ITEMS.map(({ to, label, icon: Icon, hint, ...rest }) => (
            <NavLink
              key={to}
              to={to}
              end={'end' in rest}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] leading-none transition-colors',
                  isActive ? 'text-brand' : 'text-muted-foreground',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" strokeWidth={1.8} />
              <span>{label}</span>
              <span className="text-[9px] leading-none text-muted-foreground/50">{hint}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
