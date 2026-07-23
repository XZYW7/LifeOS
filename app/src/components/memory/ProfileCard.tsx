/**
 * ProfileCard · 用户画像卡
 * ─────────────────────────────────────────────
 * 渲染 server 整理管线生成的用户画像（≤800 字 Markdown，
 * 固定四节：# 核心身份 / # 价值观与偏好 / # 稳定模式 / # 当前关注）。
 * Markdown 简单渲染：# 行加粗作为节标题，- 行作为列表项，其余按文本行；
 * 不引入 Markdown 库。无画像（profile 为空）时不渲染。
 * 对话页 MemoryPanel 与轨迹页 MemorySection 共用本组件。
 */
import type { ReactNode } from 'react';
import { Fingerprint } from 'lucide-react';
import { useLifeOS } from '@/lib/store';
import { cn } from '@/lib/utils';

/** 极简 Markdown 渲染：# 节标题加粗 / - 列表项 / 其余文本行 */
function renderProfileContent(content: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  content.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('# ')) {
      blocks.push(
        <p key={i} className="mt-2.5 text-xs font-semibold text-foreground first:mt-0">
          {line.slice(2).trim()}
        </p>,
      );
    } else if (line.startsWith('- ')) {
      blocks.push(
        <p key={i} className="relative pl-3 text-xs leading-relaxed text-foreground/90">
          <span className="absolute left-0.5 text-muted-foreground/60">·</span>
          {line.slice(2).trim()}
        </p>,
      );
    } else {
      blocks.push(
        <p key={i} className="text-xs leading-relaxed text-foreground/90">
          {line}
        </p>,
      );
    }
  });
  return blocks;
}

export default function ProfileCard({ className }: { className?: string }) {
  const profile = useLifeOS((s) => s.profile);
  if (!profile || !profile.content.trim()) return null;

  return (
    <section className={cn('rounded-md border border-border bg-card px-3 py-2.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Fingerprint className="h-3.5 w-3.5 text-brand" strokeWidth={1.8} />
          <span className="text-xs font-medium text-foreground">画像</span>
        </div>
        <span className="font-data text-[10px] text-muted-foreground/70">
          更新于 {profile.updatedAt.slice(0, 10)}
        </span>
      </div>
      <div className="mt-2 space-y-1">{renderProfileContent(profile.content)}</div>
    </section>
  );
}
