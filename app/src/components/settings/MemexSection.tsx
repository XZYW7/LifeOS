/**
 * 设置页 · memex 导入：
 * 把手机 memex 的历史备份 zip 一次性搬进 LifeOS。
 * server 离线时显示离线提示（网络失败不当作错误）；errors 非空可展开查看。
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, CloudOff, Import, Loader2 } from 'lucide-react';
import { api, ApiHttpError } from '@/lib/api';
import type { ImportResult } from '@/lib/api';
import { initServerSync } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import Section from './Section';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: ImportResult }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

export default function MemexSection() {
  const [zipPath, setZipPath] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [errorsOpen, setErrorsOpen] = useState(false);

  const handleImport = async () => {
    const path = zipPath.trim();
    if (!path || status.kind === 'loading') return;
    setStatus({ kind: 'loading' });
    setErrorsOpen(false);
    try {
      const result = await api.importMemex(path);
      // 导入改变了 server 端状态，立刻重新同步到本地 store，各页面即时可见
      await initServerSync();
      setStatus({ kind: 'done', result });
    } catch (err) {
      if (err instanceof ApiHttpError) {
        setStatus({ kind: 'error', message: `导入失败（HTTP ${err.status}），请检查 zip 路径是否正确。` });
      } else {
        // 网络层失败 = server 不可达
        setStatus({ kind: 'offline' });
      }
    }
  };

  return (
    <Section
      title="memex 导入"
      description="把手机 memex 的历史记忆搬进 LifeOS（一次性）。填入电脑上的备份 zip 路径，由 server 解析导入。"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            value={zipPath}
            onChange={(e) => setZipPath(e.target.value)}
            placeholder="C:\Users\...\memex_backup_....zip"
            className="min-w-0 flex-1 font-data text-xs"
            disabled={status.kind === 'loading'}
          />
          <Button
            size="sm"
            onClick={handleImport}
            disabled={!zipPath.trim() || status.kind === 'loading'}
          >
            {status.kind === 'loading' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <Import className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
            {status.kind === 'loading' ? '导入中…' : '导入'}
          </Button>
        </div>

        {status.kind === 'offline' && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-4 py-3 text-xs text-muted-foreground">
            <CloudOff className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            server 当前离线，暂时无法导入；等 server 启动后再试即可。
          </div>
        )}

        {status.kind === 'error' && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive-foreground">
            {status.message}
          </p>
        )}

        {status.kind === 'done' && (
          <div className="rounded-lg border border-border bg-background/40 px-4 py-3.5">
            <p className="text-xs leading-relaxed text-foreground">
              新导入 <span className="font-data text-brand">{status.result.imported.memories}</span> 条记忆 /{' '}
              <span className="font-data text-brand">{status.result.imported.tasks}</span> 个任务 /{' '}
              <span className="font-data text-brand">{status.result.imported.knowledge}</span> 条知识，
              跳过 <span className="font-data">{status.result.skipped}</span> 条重复
              {(status.result.threadsDerived ?? 0) > 0 && (
                <>
                  ，并自动梳理出{' '}
                  <span className="font-data text-brand">{status.result.threadsDerived}</span> 条线程
                  （去「线程」页看看）
                </>
              )}
            </p>
            {status.result.errors.length > 0 && (
              <div className="mt-2.5">
                <button
                  type="button"
                  onClick={() => setErrorsOpen((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {errorsOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                  )}
                  {status.result.errors.length} 条导入异常
                </button>
                <ul
                  className={cn(
                    'mt-1.5 space-y-1 border-l border-border pl-3',
                    !errorsOpen && 'hidden',
                  )}
                >
                  {status.result.errors.map((msg, i) => (
                    <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                      {msg}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
