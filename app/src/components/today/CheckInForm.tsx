/**
 * 状态打卡表单（< 30 秒完成）：
 * 能量三档大按钮 + 五维定性标签 + 睡眠简选 + 一句可选 note。
 * 所有维度预选中位值，用户只需改动不符合的项即可提交。
 */
import { useState } from 'react';
import { BatteryCharging } from 'lucide-react';
import type { DailyState, DimensionState, EnergyLevel } from '@/types';
import { todayStr, uid, USER_ID } from '@/lib/store';
import { cn } from '@/lib/utils';
import { DIMENSION_PRESETS, ENERGY_OPTIONS, MODE_META, SLEEP_OPTIONS, type DimensionKey } from './meta';

interface Props {
  onSubmit: (state: DailyState) => void;
}

function toDimensionState(tagIndex: number, tags: string[]): DimensionState {
  const level = Math.max(1, 5 - tagIndex) as 1 | 2 | 3 | 4 | 5;
  return { tag: tags[tagIndex], level };
}

export default function CheckInForm({ onSubmit }: Props) {
  const [energy, setEnergy] = useState<EnergyLevel>('medium');
  const [dimSel, setDimSel] = useState<Record<DimensionKey, number>>({
    body: 2,
    emotion: 2,
    social: 2,
    creative: 2,
    learning: 2,
  });
  const [sleepHours, setSleepHours] = useState<number>(7.5);
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    const dims = Object.fromEntries(
      DIMENSION_PRESETS.map((p) => [p.key, toDimensionState(dimSel[p.key], p.tags)]),
    ) as Record<DimensionKey, DimensionState>;

    onSubmit({
      id: uid('state'),
      userId: USER_ID,
      date: todayStr(),
      energy,
      ...dims,
      sleepHours,
      note: note.trim() || undefined,
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <BatteryCharging className="h-4 w-4 text-brand" strokeWidth={1.8} />
        今日还没有状态记录 — 30 秒打个卡，Agent 才能判断今天该怎么过。
      </div>

      {/* 能量三档 */}
      <div className="mt-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">此刻的能量</div>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {ENERGY_OPTIONS.map((opt) => {
            const meta = MODE_META[opt.value];
            const Icon = meta.icon;
            const active = energy === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEnergy(opt.value)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border px-3 py-4 transition-colors',
                  active
                    ? cn(meta.ring, meta.softBg, 'text-foreground')
                    : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className={cn('h-5 w-5', active && meta.accent)} strokeWidth={1.8} />
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 五维定性标签 */}
      <div className="mt-6 space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">五个维度，各选一个最接近的</div>
        {DIMENSION_PRESETS.map((preset) => (
          <div key={preset.key} className="flex items-center gap-3">
            <span className="w-10 shrink-0 text-sm text-muted-foreground">{preset.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {preset.tags.map((tag, idx) => {
                const active = dimSel[preset.key] === idx;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setDimSel((prev) => ({ ...prev, [preset.key]: idx }))}
                    className={cn(
                      'inline-flex min-h-[44px] items-center rounded-full border px-3.5 py-1 text-xs transition-colors md:min-h-0',
                      active
                        ? 'border-brand/50 bg-brand/10 text-brand'
                        : 'border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 睡眠 + note */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">昨晚睡眠</span>
        <div className="flex gap-1.5">
          {SLEEP_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setSleepHours(opt.value)}
              className={cn(
                'inline-flex min-h-[44px] items-center rounded-full border px-3.5 py-1 font-data text-xs transition-colors md:min-h-0',
                sleepHours === opt.value
                  ? 'border-brand/50 bg-brand/10 text-brand'
                  : 'border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="一句话补充（可选）：今天感觉……"
        className="mt-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-brand/50 focus:outline-none"
      />

      <button
        type="button"
        onClick={handleSubmit}
        className="mt-5 min-h-[44px] w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        完成打卡，看看今天怎么过
      </button>
    </section>
  );
}
