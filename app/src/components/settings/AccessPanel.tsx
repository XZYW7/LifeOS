/**
 * 手机访问面板（独立路由 /access，也可内嵌进设置页）
 * ─────────────────────────────────────────────────────────────
 * - 调 GET /api/access-info 显示局域网地址（大字、点击复制）。
 *   server 该接口未上线时兜底提示，不影响其余功能。
 * - serverUrl 输入框：写入 localStorage lifeos-server-url（api.ts 的
 *   setServerUrl），留空 = 同源相对路径。APK 离线包场景在此填后端地址。
 */

import { useEffect, useState } from 'react';
import { Check, Copy, Smartphone, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { api, getServerUrl, setServerUrl, type AccessInfo } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function LanUrlRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('已复制');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API 不可用（非安全上下文等）：选不中就给提示
      toast.error('复制失败，请手动长按复制');
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted"
      title="点击复制"
    >
      <span className="font-mono text-xl font-semibold tracking-tight sm:text-2xl">{url}</span>
      {copied ? (
        <Check className="h-5 w-5 shrink-0 text-green-600" />
      ) : (
        <Copy className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

export default function AccessPanel() {
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverUrl, setServerUrlState] = useState(() => getServerUrl());

  useEffect(() => {
    let cancelled = false;
    api
      .getAccessInfo()
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data.port === 'number' && Array.isArray(data.lanUrls)) {
          setInfo(data);
        } else {
          setLoadError('接口返回格式不符合契约');
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('后端 /api/access-info 暂未上线或不可达');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveServerUrl = () => {
    setServerUrl(serverUrl);
    const normalized = getServerUrl();
    toast.success(normalized ? `后端地址已设置为 ${normalized}` : '已恢复同源模式');
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            手机访问
          </CardTitle>
          <CardDescription>
            手机连同一 WiFi，用浏览器打开下面任一地址即可使用 LifeOS。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {info ? (
            <>
              {info.lanUrls.length > 0 ? (
                info.lanUrls.map((url) => <LanUrlRow key={url} url={url} />)
              ) : (
                <p className="text-sm text-muted-foreground">
                  未检测到局域网地址，请确认电脑已连接 WiFi。端口：{info.port}
                </p>
              )}
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Wifi className="h-4 w-4" />
                手机与电脑需在同一局域网；点击地址即可复制。
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {loadError ?? '正在获取局域网地址…'}
              {loadError && (
                <>
                  <br />
                  也可在电脑浏览器访问「设置 → 网络」查看本机 IP，手机浏览器打开
                  <span className="font-mono"> http://&lt;电脑IP&gt;:3456</span>。
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>后端地址</CardTitle>
          <CardDescription>
            留空 = 同源（网页版默认）。APK 离线包或连接其他电脑的后端时，填写完整地址，如
            http://192.168.1.10:3456。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="server-url">Server URL</Label>
            <div className="flex gap-2">
              <Input
                id="server-url"
                value={serverUrl}
                onChange={(e) => setServerUrlState(e.target.value)}
                placeholder="留空 = 同源，例如 http://192.168.1.10:3456"
                className="font-mono"
              />
              <Button type="button" onClick={saveServerUrl}>
                保存
              </Button>
            </div>
            {getServerUrl() && (
              <p className="text-sm text-muted-foreground">
                当前生效：<span className="font-mono">{getServerUrl()}</span>
                （清空输入框后保存即恢复同源）
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
