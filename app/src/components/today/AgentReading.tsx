/**
 * 「今天」页 · Agent 解读卡 + 最近人生版本卡（自原首页迁入）
 */
import { Link } from 'react-router-dom';
import { ChevronRight, GitCommitHorizontal, ScanEye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { analyzeState } from '@/lib/agent';
import { getAllStates, useLifeOS } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import type { DiagnosisType, EnergyLevel } from '@/types';

const DIAGNOSIS_LABEL: Record<DiagnosisType, string> = {
  recovery: '恢复需求',
  motivation: '动力不足',
  emotional_low: '情绪性低落',
  normal: '常规日',
};

const MODE_LABEL: Record<EnergyLevel, string> = {
  high: '高性能',
  medium: '平衡',
  low: '省电',
};

export function AgentReadingCard() {
  const states = useLifeOS(useShallow(getAllStates));
  const tasks = useLifeOS((s) => s.tasks);
  const memories = useLifeOS((s) => s.memories);

  const analysis = analyzeState(states, tasks, memories);
  const paragraphs = analysis.reasoning.split('\n').filter(Boolean);

  return (
    <Card className="gap-0 py-0">
      <CardContent className="px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScanEye className="h-4 w-4 text-brand" strokeWidth={1.8} />
            <h2 className="text-sm font-medium text-foreground">Agent 观察</h2>
          </div>
          <div className="flex items-center gap-2 font-data text-[11px] text-muted-foreground">
            <span className="rounded border border-border bg-accent/60 px-1.5 py-0.5">
              {analysis.rule}
            </span>
            <span>{DIAGNOSIS_LABEL[analysis.diagnosis]}</span>
            {analysis.confidence !== '—' && <span>置信 {analysis.confidence}</span>}
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-foreground/85">
              {p}
            </p>
          ))}
        </div>

        {analysis.patterns.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {analysis.patterns.map((p) => (
              <span
                key={p}
                className="rounded border border-olive/30 bg-olive/10 px-2 py-1 text-[11px] text-olive"
              >
                {p}
              </span>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-[11px] text-muted-foreground">
            建议模式：<span className="font-data text-foreground">{MODE_LABEL[analysis.suggestedMode]}</span>
            {analysis.evidence && <span className="ml-2">依据：{analysis.evidence}</span>}
          </span>
          <Link
            to="/chat"
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-brand"
          >
            与 Agent 讨论
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export function VersionCard() {
  const lifeVersions = useLifeOS((s) => s.lifeVersions);
  const latest = [...lifeVersions].sort((a, b) => b.date.localeCompare(a.date))[0];

  if (!latest) {
    return (
      <Link to="/timeline" className="group block">
        <Card className="gap-0 border-dashed py-0 transition-colors hover:border-brand/40">
          <CardContent className="px-4 py-6 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] tracking-wide text-muted-foreground">
                <GitCommitHorizontal className="h-3.5 w-3.5 text-brand" strokeWidth={1.8} />
                最近的人生版本
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              还没有人生版本。走过一段路之后，去时间线为这段日子做一次提交。
            </p>
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <Link to="/timeline" className="group block">
      <Card className="gap-0 py-0 transition-colors hover:border-brand/40">
        <CardContent className="px-4 py-6 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] tracking-wide text-muted-foreground">
              <GitCommitHorizontal className="h-3.5 w-3.5 text-brand" strokeWidth={1.8} />
              最近的人生版本
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
          </div>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-data text-sm text-brand">v{latest.version}</span>
            <span className="font-data text-[11px] text-muted-foreground">{latest.date}</span>
          </div>

          <p className="mt-2.5 text-[13px] leading-relaxed text-foreground/85">
            {latest.summary}
          </p>

          <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>获得 {latest.gained.length} 项</span>
            <span className="text-border">|</span>
            <span>释放 {latest.released.length} 项</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
