/**
 * 设置页 · 长期愿景（收敛版）
 * ─────────────────────────────────────────────
 * 单行文本「我想成为谁」，编辑 user.visionText，
 * 走 store.updateUser → POST /api/users（离线时仅本地，server 在线自动同步）。
 * 取代原 visions 集合的创建/编辑表单（VisionSection 已删）。
 *
 * 注：User.visionText 字段由另一 worker 在 types/index.ts 中补充，
 * 落盘前这里用局部类型读取，不产生类型错误。
 */
import { useState } from 'react';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLifeOS } from '@/lib/store';
import Section from './Section';

/** user.visionText 落入 types/index.ts 前的过渡读取 */
type UserWithVision = { visionText?: string };

export default function VisionTextSection() {
  const visionText = useLifeOS((s) => (s.user as UserWithVision).visionText ?? '');
  const updateUser = useLifeOS((s) => s.updateUser);

  const [text, setText] = useState(visionText);
  const [saved, setSaved] = useState(false);

  const handleSubmit = () => {
    // visionText 即将加入 User 类型；在此之前用宽松补丁对象
    updateUser({ visionText: text.trim() } as Parameters<typeof updateUser>[0]);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  return (
    <Section
      title="长期愿景"
      description="北极星方向——不设 deadline、不设进度百分比，只回答「我想成为谁」。Agent 的所有建议都会向它对齐。"
    >
      {!visionText && (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-dashed border-border bg-background/40 px-3.5 py-3">
          <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={1.8} />
          <p className="text-xs leading-relaxed text-muted-foreground">
            还没有写下愿景。一句话就够，线程焦点的挑选会向它对齐。
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="vision-text">我想成为谁</Label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            id="vision-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="如：一个持续创作、身体轻盈、关系温热的人"
            maxLength={80}
            className="max-w-xl"
          />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleSubmit} disabled={text.trim() === visionText}>
              保存
            </Button>
            {saved && <span className="text-xs text-olive">已保存</span>}
          </div>
        </div>
      </div>
    </Section>
  );
}
