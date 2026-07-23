/**
 * 「今天」页 · 五维状态面板（自原首页 homepage/DimensionPanel 迁入）
 * 身体 / 情绪 / 社交 / 创造 / 学习：定性标签 + 近 7 天趋势小条形。
 * level 只用于渲染趋势高度，界面不展示数值——自我观察，不是打分。
 */
import { Activity, BookOpen, CloudSun, Sparkles, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { getRecentStates, getTodayState, useLifeOS } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import type { DailyState, DimensionState } from '@/types';

interface DimDef {
  key: 'body' | 'emotion' | 'social' | 'creative' | 'learning';
  label: string;
  icon: typeof Activity;
}

const DIMS: DimDef[] = [
  { key: 'body', label: '身体', icon: Activity },
  { key: 'emotion', label: '情绪', icon: CloudSun },
  { key: 'social', label: '社交', icon: Users },
  { key: 'creative', label: '创造', icon: Sparkles },
  { key: 'learning', label: '学习', icon: BookOpen },
];

/** 趋势条配色：低位用暗沉的琥珀，中位灰，高位橄榄绿——低饱和、无警示红 */
function barClass(level: number): string {
  if (level >= 4) return 'bg-olive/80';
  if (level === 3) return 'bg-muted-foreground/45';
  return 'bg-brand-dim/60';
}

function TrendBars({ states, dimKey }: { states: DailyState[]; dimKey: DimDef['key'] }) {
  return (
    <div className="flex h-8 items-end gap-1" aria-hidden>
      {states.map((s) => {
        const level = s[dimKey].level ?? 3;
        return (
          <div
            key={s.date}
            title={`${s.date} · ${s[dimKey].tag}`}
            className={cn('w-1.5 rounded-sm', barClass(level))}
            style={{ height: `${Math.max(18, (level / 5) * 100)}%` }}
          />
        );
      })}
      {states.length === 0 && (
        <span className="self-center text-[11px] text-muted-foreground">暂无记录</span>
      )}
    </div>
  );
}

function currentDim(today: DailyState | undefined, recent: DailyState[], key: DimDef['key']): DimensionState | undefined {
  if (today) return today[key];
  return recent.length > 0 ? recent[recent.length - 1][key] : undefined;
}

export default function DimensionPanel() {
  const today = useLifeOS(getTodayState);
  const recent = useLifeOS(useShallow((s) => getRecentStates(s, 7)));

  return (
    <Card className="gap-0 py-0">
      <CardContent className="px-4 py-6 sm:px-6">
        <h2 className="text-sm font-medium text-foreground">五维状态 · 近 7 天</h2>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {DIMS.map(({ key, label, icon: Icon }) => {
            const dim = currentDim(today, recent, key);
            return (
              <div
                key={key}
                className="rounded-lg border border-border bg-background/40 px-3.5 py-3"
              >
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Icon className="h-3.5 w-3.5 text-brand/80" strokeWidth={1.8} />
                  {label}
                </div>
                <div className="mt-1.5 min-h-5 truncate text-sm text-foreground">
                  {dim ? dim.tag : '—'}
                </div>
                <div className="mt-2">
                  <TrendBars states={recent} dimKey={key} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
