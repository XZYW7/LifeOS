/**
 * 设置页：把演示数据换成自己的真实数据。
 * 区块：个人资料 / 长期愿景（我想成为谁）/ memex 导入 / 数据管理。
 * （目标管理 GoalsSection 已随目标树概念删除。）
 */
import { Settings } from 'lucide-react';
import ProfileSection from '@/components/settings/ProfileSection';
import VisionTextSection from '@/components/settings/VisionTextSection';
import MemexSection from '@/components/settings/MemexSection';
import DataSection from '@/components/settings/DataSection';

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
      <header>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Settings className="h-3.5 w-3.5 text-brand" strokeWidth={1.8} />
          档案与数据
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">设置</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          档案只在第一次需要认真填，之后偶尔回来改——把演示内容换成你自己的愿景与节律。
        </p>
      </header>

      <ProfileSection />
      <VisionTextSection />
      <MemexSection />
      <DataSection />
    </div>
  );
}
