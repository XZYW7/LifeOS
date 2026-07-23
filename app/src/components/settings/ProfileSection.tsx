/**
 * 设置页 · 个人资料：昵称与人生阶段标签。
 * 保存时调用 updateUser(patch)。
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLifeOS } from '@/lib/store';
import Section from './Section';

export default function ProfileSection() {
  const user = useLifeOS((s) => s.user);
  const updateUser = useLifeOS((s) => s.updateUser);

  const [name, setName] = useState(user.name);
  const [lifeStageTag, setLifeStageTag] = useState(user.lifeStageTag ?? '');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateUser({ name: trimmed, lifeStageTag: lifeStageTag.trim() || undefined });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  return (
    <Section title="个人资料" description="昵称与当前人生阶段，会显示在角色面板与导航上。">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="profile-name">昵称</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="怎么称呼你"
            maxLength={20}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-stage">人生阶段</Label>
          <Input
            id="profile-stage"
            value={lifeStageTag}
            onChange={(e) => setLifeStageTag(e.target.value)}
            placeholder="如：探索期 / 职业转换期"
            maxLength={12}
          />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button size="sm" onClick={handleSave} disabled={!name.trim()}>
          保存
        </Button>
        {saved && <span className="text-xs text-olive">已保存</span>}
      </div>
    </Section>
  );
}
