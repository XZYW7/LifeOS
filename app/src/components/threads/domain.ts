/**
 * 线程领域元数据：4 领域固定顺序 + 图标 + 克制配色。
 * 配色沿用 LifeOS 暖色主题：琥珀（brand）/ 橄榄（olive）/ 陶土 / 暖灰。
 */
import { Briefcase, Sparkles, Users, Sprout, type LucideIcon } from 'lucide-react';
import type { ThreadDomain } from '@/types';

export const DOMAIN_ORDER: ThreadDomain[] = ['career', 'creation', 'relationship', 'self'];

export const DOMAIN_META: Record<
  ThreadDomain,
  { label: string; icon: LucideIcon; textClass: string }
> = {
  career: { label: '职业', icon: Briefcase, textClass: 'text-brand' },
  creation: { label: '创造', icon: Sparkles, textClass: 'text-olive' },
  relationship: { label: '关系', icon: Users, textClass: 'text-[#b08968]' },
  self: { label: '自我', icon: Sprout, textClass: 'text-muted-foreground' },
};

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期 */
export function relTime(iso?: string): string {
  if (!iso) return '尚未触碰';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '尚未触碰';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return iso.slice(0, 10);
}
