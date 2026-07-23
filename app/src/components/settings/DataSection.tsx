/**
 * 设置页 · 数据管理：
 * 「清空全部数据，从零开始」→ confirm + prompt 昵称 → clearToBlank(name)
 * 「恢复演示数据」→ confirm → resetToSeed()
 * 两个动作都有二次确认，且不可撤销，文案保持克制。
 */
import { useNavigate } from 'react-router-dom';
import { Eraser, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLifeOS } from '@/lib/store';
import Section from './Section';

export default function DataSection() {
  const clearToBlank = useLifeOS((s) => s.clearToBlank);
  const resetToSeed = useLifeOS((s) => s.resetToSeed);
  const navigate = useNavigate();

  const handleClear = () => {
    if (!window.confirm('确定要清空全部数据吗？愿景、目标、打卡记录、记忆与对话都会被移除，且无法恢复。')) return;
    const name = window.prompt('给自己起个昵称，作为新档案的开始（留空则使用默认）', '');
    if (name === null) return; // 用户取消
    clearToBlank(name);
    navigate('/');
  };

  const handleResetSeed = () => {
    if (!window.confirm('确定要恢复演示数据吗？当前所有数据都会被替换为演示内容，且无法恢复。')) return;
    resetToSeed();
    navigate('/');
  };

  return (
    <Section
      title="数据管理"
      description="两个操作都会立即生效且不可撤销，请确认后再执行。"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-sm text-foreground">清空全部数据，从零开始</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              移除演示内容与全部记录，保留一份只属于你的空白档案。
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleClear}>
            <Eraser className="h-3.5 w-3.5" strokeWidth={1.8} />
            清空并从零开始
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-sm text-foreground">恢复演示数据</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              用内置的合成演示档案覆盖当前全部数据，用于体验完整功能；其中不包含真实用户数据。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleResetSeed}>
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
            恢复演示数据
          </Button>
        </div>
      </div>
    </Section>
  );
}
