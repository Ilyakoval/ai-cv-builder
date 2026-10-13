'use client';

import type { JobDto } from '@cvb/shared';
import { useEffect, useState } from 'react';
import { STAGES } from '@/lib/format';
import { Card, Spinner, cx } from './ui';

/**
 * Progress is read from the server-side job record, so a reload, a closed tab
 * or opening the CV on another device shows the same state.
 */
export function GenerationProgress({ job }: { job: JobDto | undefined }) {
  const stage = job?.stage ?? 'queued';
  const current = Math.max(0, STAGES.findIndex((s) => s.key === stage));
  const elapsed = useElapsed(job?.createdAt);

  return (
    <Card className="mx-auto max-w-xl">
      <div className="flex items-center gap-3">
        <Spinner className="h-6 w-6 text-brand" />
        <div>
          <h2 className="font-medium">Building your CV</h2>
          <p className="text-sm text-muted">
            Usually under a minute. You can leave this page — we&apos;ll keep working and your CV will be here when you come back.
          </p>
        </div>
      </div>
      <ol className="mt-6 space-y-3">
        {STAGES.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 text-sm">
            <span
              className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                i < current && 'border-success bg-success text-surface',
                i === current && 'border-brand text-brand',
                i > current && 'border-line text-muted',
              )}
            >
              {i < current ? '✓' : i + 1}
            </span>
            <span className={cx(i === current ? 'font-medium' : i > current && 'text-muted')}>{s.label}</span>
          </li>
        ))}
      </ol>
      {job?.error && <p className="mt-4 text-sm text-warn">{job.error}</p>}
      {elapsed > 0 && <p className="mt-4 text-xs text-muted">Elapsed: {elapsed}s</p>}
    </Card>
  );
}

function useElapsed(since?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return since ? Math.max(0, Math.round((now - new Date(since).getTime()) / 1000)) : 0;
}
