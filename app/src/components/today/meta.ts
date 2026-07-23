/**
 * TodayPage 共享常量：能量模式元信息 + 五维打卡预设标签。
 */
import { Zap, Leaf, Moon, type LucideIcon } from 'lucide-react';
import type { EnergyLevel } from '@/types';

export const MODE_META: Record<
  EnergyLevel,
  { label: string; tagline: string; icon: LucideIcon; accent: string; softBg: string; ring: string; dot: string }
> = {
  high: {
    label: '性能模式',
    tagline: '全量推进，重任务优先',
    icon: Zap,
    accent: 'text-brand',
    softBg: 'bg-brand/10',
    ring: 'border-brand/40',
    dot: 'bg-brand',
  },
  medium: {
    label: '平衡模式',
    tagline: '推进与恢复各占一半',
    icon: Leaf,
    accent: 'text-olive',
    softBg: 'bg-olive/10',
    ring: 'border-olive/40',
    dot: 'bg-olive',
  },
  low: {
    label: '省电模式',
    tagline: '砍量保链，恢复优先',
    icon: Moon,
    accent: 'text-muted-foreground',
    softBg: 'bg-muted/50',
    ring: 'border-border',
    dot: 'bg-muted-foreground',
  },
};

export type DimensionKey = 'body' | 'emotion' | 'social' | 'creative' | 'learning';

export interface DimensionPreset {
  key: DimensionKey;
  label: string;
  /** 从好到差排列，index 0 对应 level 5 */
  tags: string[];
}

export const DIMENSION_PRESETS: DimensionPreset[] = [
  { key: 'body', label: '身体', tags: ['充沛', '良好', '一般', '疲劳', '透支'] },
  { key: 'emotion', label: '情绪', tags: ['上扬', '平稳偏积极', '平稳', '偏低', '低落'] },
  { key: 'social', label: '社交', tags: ['热络', '适度', '低功耗', '回避', '不想说话'] },
  { key: 'creative', label: '创造', tags: ['心流', '有想法', '平常', '停滞', '枯竭'] },
  { key: 'learning', label: '学习', tags: ['高效吸收', '正常', '缓慢', '读不进去', '无法集中'] },
];

export const SLEEP_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '<6h', value: 5.5 },
  { label: '6–7h', value: 6.5 },
  { label: '7–8h', value: 7.5 },
  { label: '>8h', value: 8.5 },
];

export const ENERGY_OPTIONS: Array<{ value: EnergyLevel; label: string; hint: string }> = [
  { value: 'high', label: '充沛', hint: '可以攻坚' },
  { value: 'medium', label: '一般', hint: '正常推进' },
  { value: 'low', label: '低', hint: '需要省着用' },
];
