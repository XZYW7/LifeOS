/**
 * 设置页区块外壳：标题 + 说明 + 内容。
 */
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  title: string;
  description?: string;
  children: ReactNode;
}

export default function Section({ title, description, children }: Props) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="px-4 py-6 sm:px-6">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
        <div className="mt-5">{children}</div>
      </CardContent>
    </Card>
  );
}
