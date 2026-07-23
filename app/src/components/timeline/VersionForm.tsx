/**
 * Timeline 页 · 新建人生版本表单（对应"记录一个版本"手动触发）
 * 三段正文按行拆分入库，均可留空；提交调用 addLifeVersion。
 */
import { useState } from 'react';
import { GitCommitHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useLifeOS, todayStr, uid } from '@/lib/store';
import type { LifeVersion } from '@/types';

const splitLines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

interface Props {
  onCreated: (id: string) => void;
}

export default function VersionForm({ onCreated }: Props) {
  const userId = useLifeOS((s) => s.user.id);
  const addLifeVersion = useLifeOS((s) => s.addLifeVersion);

  const [name, setName] = useState('');
  const [date, setDate] = useState(todayStr());
  const [happened, setHappened] = useState('');
  const [gained, setGained] = useState('');
  const [released, setReleased] = useState('');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const version = name.trim();
    if (!version) {
      setError('给这个版本起个名字吧，比如 2026-07 或 夏天·转向。');
      return;
    }
    const entry: LifeVersion = {
      id: uid('lv'),
      userId,
      version,
      date: date || todayStr(),
      happened: splitLines(happened),
      gained: splitLines(gained),
      released: splitLines(released),
      summary: summary.trim() || '这一版还没有写小结。',
      createdAt: new Date().toISOString(),
    };
    addLifeVersion(entry);
    setName('');
    setHappened('');
    setGained('');
    setReleased('');
    setSummary('');
    setError('');
    onCreated(entry.id);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">版本名</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如 2026-07 或 夏天·转向"
            className="border-border bg-background font-data text-sm"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">发布日期</label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border-border bg-background font-data text-sm"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">发生了什么</label>
          <Textarea
            value={happened}
            onChange={(e) => setHappened(e.target.value)}
            placeholder={'关键事件，每行一条'}
            rows={4}
            className="border-border bg-background text-sm"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-olive">获得了什么</label>
          <Textarea
            value={gained}
            onChange={(e) => setGained(e.target.value)}
            placeholder={'能力 / 作品 / 关系，每行一条'}
            rows={4}
            className="border-border bg-background text-sm"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-muted-foreground">放弃了什么</label>
          <Textarea
            value={released}
            onChange={(e) => setReleased(e.target.value)}
            placeholder={'目标 / 执念 / 身份，每行一条'}
            rows={4}
            className="border-border bg-background text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs text-muted-foreground">版本小结（可选）</label>
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="一两句话，给这个阶段的自己"
          rows={2}
          className="border-border bg-background text-sm"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" className="gap-2 bg-brand text-primary-foreground hover:bg-brand-deep">
          <GitCommitHorizontal className="h-4 w-4" />
          提交这个版本
        </Button>
      </div>
    </form>
  );
}
