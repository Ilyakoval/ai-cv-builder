'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Button, Card, Spinner, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { relativeTime, STATUS_LABEL } from '@/lib/format';

export default function CvListPage() {
  const cvs = useQuery({
    queryKey: ['cvs'],
    queryFn: api.listCvs,
    // Keep the list live while something is still generating.
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === 'generating') ? 3000 : false),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your CVs</h1>
          <p className="text-sm text-muted">Each CV is tailored to one target role.</p>
        </div>
        <Link href="/cvs/new">
          <Button>New CV</Button>
        </Link>
      </div>

      {cvs.isPending && (
        <div className="flex justify-center py-16 text-muted">
          <Spinner />
        </div>
      )}
      {cvs.isError && (
        <Alert action={<Button variant="secondary" onClick={() => cvs.refetch()}>Retry</Button>}>{cvs.error.message}</Alert>
      )}
      {cvs.data?.length === 0 && (
        <Card className="py-12 text-center">
          <h2 className="text-lg font-medium">No CVs yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Upload your current CV as a PDF or describe your background, pick a target role, and we&apos;ll draft a focused CV.
          </p>
          <Link href="/cvs/new" className="mt-4 inline-block">
            <Button>Create your first CV</Button>
          </Link>
        </Card>
      )}
      {cvs.data && cvs.data.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cvs.data.map((cv) => (
            <li key={cv.id}>
              <Link
                href={`/cvs/${cv.id}`}
                className="block h-full rounded-xl border border-line bg-surface p-4 shadow-sm transition hover:border-accent/40 hover:shadow"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-medium leading-snug">{cv.title}</h2>
                  <span
                    className={cx(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                      cv.status === 'ready' && 'bg-emerald-50 text-emerald-700',
                      cv.status === 'generating' && 'bg-blue-50 text-blue-700',
                      cv.status === 'failed' && 'bg-red-50 text-red-700',
                    )}
                  >
                    {STATUS_LABEL[cv.status]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">Target: {cv.targetRole}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>Updated {relativeTime(cv.updatedAt)}</span>
                  {cv.openQuestions > 0 && <span className="text-amber-700">{cv.openQuestions} question{cv.openQuestions > 1 ? 's' : ''}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
