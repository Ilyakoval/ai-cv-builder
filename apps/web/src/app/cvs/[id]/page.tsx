'use client';

import type { CvDetailDto, CvSection, QuestionDto } from '@cvb/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { CvEditor } from '@/components/CvEditor';
import { GenerationProgress } from '@/components/GenerationProgress';
import { QuestionsPanel } from '@/components/QuestionsPanel';
import { Alert, Button, Input, Spinner } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useCvDraft, type SaveState } from '@/lib/useCvDraft';

const isActive = (cv?: CvDetailDto) =>
  !!cv && (cv.status === 'generating' || cv.jobs.some((j) => j.status === 'queued' || j.status === 'running'));

export default function CvPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['cv', id],
    queryFn: () => api.getCv(id),
    // Poll only while the server is working on this CV.
    refetchInterval: (q) => (isActive(q.state.data) ? 1500 : false),
    refetchOnWindowFocus: true,
  });
  const cv = query.data;
  const { draft, update, flush, reloadLatest, state, issues } = useCvDraft(cv);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  if (query.isPending) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <Spinner />
      </div>
    );
  }
  if (query.isError || !cv) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <Alert action={!notFound && <Button variant="secondary" onClick={() => query.refetch()}>Retry</Button>}>
        {notFound ? 'This CV does not exist or belongs to another account.' : query.error?.message}{' '}
        <Link href="/cvs" className="underline">
          Back to your CVs
        </Link>
      </Alert>
    );
  }

  const setCv = (next: CvDetailDto) => {
    qc.setQueryData(['cv', id], next);
    void qc.invalidateQueries({ queryKey: ['cvs'] });
  };
  const latestGenerate = cv.jobs.find((j) => j.type === 'generate');

  async function guarded(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function onAnswer(q: QuestionDto, answer: string) {
    // Persist local edits first, otherwise the server merges into a stale version.
    if (!(await flush())) throw new Error('Save your edits first (see the message above the CV).');
    setCv(await api.answer(id, q.id, answer));
  }

  async function download() {
    setDownloading(true);
    await guarded(async () => {
      if (!(await flush())) throw new Error('Your latest edits could not be saved, so the PDF would be out of date.');
      const res = await fetch(api.pdfUrl(id), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Could not generate the PDF. Please try again.');
      const blob = await res.blob();
      const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name ? decodeURIComponent(name) : 'cv.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    });
    setDownloading(false);
  }

  const openQs = cv.questions.filter((q) => q.status === 'open' || q.status === 'applying');
  const highlight = (section: CvSection, itemId?: string) =>
    openQs.some((q) => q.section === section && (itemId ? q.itemId === itemId : q.itemId === null));

  return (
    <div className="space-y-5">
      <Header cv={cv} onRename={(title) => guarded(async () => setCv(await api.renameCv(id, title)))} />

      {actionError && <Alert>{actionError}</Alert>}

      {cv.status === 'generating' && !cv.document && <GenerationProgress job={latestGenerate} />}

      {cv.status === 'failed' && (
        <Alert
          action={
            <Button variant="secondary" onClick={() => guarded(async () => setCv(await api.regenerate(id)))}>
              Try again
            </Button>
          }
        >
          {latestGenerate?.error ?? 'Generation failed.'}
          {cv.document && ' Your previous version is shown below.'}
        </Alert>
      )}

      {cv.status === 'generating' && cv.document && (
        <Alert tone="info">
          <span className="inline-flex items-center gap-2">
            <Spinner className="h-4 w-4" /> Regenerating… your current version stays editable until the new one is ready.
          </span>
        </Alert>
      )}

      {draft && (
        <>
          <Toolbar
            state={state}
            downloading={downloading}
            onDownload={download}
            onRegenerate={() => {
              if (window.confirm('Regenerate this CV from your original input and answers? Manual edits will be replaced.')) {
                void guarded(async () => setCv(await api.regenerate(id)));
              }
            }}
            onDelete={() => {
              if (window.confirm('Delete this CV? This cannot be undone.')) {
                void guarded(async () => {
                  await api.deleteCv(id);
                  void qc.invalidateQueries({ queryKey: ['cvs'] });
                  router.replace('/cvs');
                });
              }
            }}
            regenerating={cv.status === 'generating'}
          />
          {state === 'conflict' && (
            <Alert tone="warning" action={<Button variant="secondary" onClick={() => void reloadLatest()}>Load latest</Button>}>
              This CV was changed elsewhere (another tab or device, or an applied answer). Loading the latest version discards your unsaved edits here.
            </Alert>
          )}
          {state === 'invalid' && (
            <Alert tone="warning">
              Not saved — please fix:
              <ul className="mt-1 list-disc pl-5">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Alert>
          )}
          {state === 'error' && (
            <Alert action={<Button variant="secondary" onClick={() => void flush()}>Retry save</Button>}>
              Couldn&apos;t save your changes. They are kept on this page — retry when you&apos;re back online.
            </Alert>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            {/* On phones, questions come first: they are the next thing to do. */}
            <aside className="order-first space-y-4 lg:order-last lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
              <QuestionsPanel cv={cv} onAnswer={onAnswer} onDismiss={async (q) => setCv(await api.dismiss(id, q.id))} />
              <RemovedClaims cv={cv} />
            </aside>
            <CvEditor doc={draft} update={update} highlight={highlight} />
          </div>
        </>
      )}
    </div>
  );
}

function Header({ cv, onRename }: { cv: CvDetailDto; onRename: (title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(cv.title);
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Link href="/cvs" className="text-sm text-muted hover:text-ink">
          ← All CVs
        </Link>
        {editing ? (
          <form
            className="mt-1 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (title.trim()) await onRename(title.trim());
              setEditing(false);
            }}
          >
            <Input value={title} maxLength={120} autoFocus onChange={(e) => setTitle(e.target.value)} aria-label="CV title" />
            <Button type="submit">Save</Button>
          </form>
        ) : (
          <h1 className="mt-1 truncate text-2xl font-semibold">
            {cv.title}{' '}
            <button className="align-middle text-sm font-normal text-accent hover:underline" onClick={() => { setTitle(cv.title); setEditing(true); }}>
              Rename
            </button>
          </h1>
        )}
        <p className="text-sm text-muted">
          Target role: {cv.targetRole} · Source: {cv.sourceType === 'pdf' ? cv.sourceFileName ?? 'PDF' : 'text'}
        </p>
      </div>
    </div>
  );
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: 'All changes saved',
  pending: 'Unsaved changes…',
  saving: 'Saving…',
  saved: 'All changes saved',
  invalid: 'Not saved',
  error: 'Not saved',
  conflict: 'Not saved',
};

function Toolbar(props: {
  state: SaveState;
  downloading: boolean;
  regenerating: boolean;
  onDownload: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-y border-line bg-canvas/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
      <span className="text-sm text-muted" aria-live="polite">
        {SAVE_LABEL[props.state]}
      </span>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={props.onDelete}>
          Delete
        </Button>
        <Button variant="secondary" onClick={props.onRegenerate} disabled={props.regenerating}>
          Regenerate
        </Button>
        <Button onClick={props.onDownload} loading={props.downloading}>
          Download PDF
        </Button>
      </div>
    </div>
  );
}

function RemovedClaims({ cv }: { cv: CvDetailDto }) {
  if (cv.removedClaims.length === 0) return null;
  return (
    <details className="rounded-lg border border-line bg-surface p-3 text-sm">
      <summary className="cursor-pointer text-muted">Left out by fact-check ({cv.removedClaims.length})</summary>
      <p className="mt-2 text-xs text-muted">
        The AI suggested these, but we couldn&apos;t find them in your input, so they are not in your CV. Add them by hand if they are true.
      </p>
      <ul className="mt-2 space-y-2">
        {cv.removedClaims.map((r, i) => (
          <li key={i} className="border-l-2 border-line pl-2">
            <p>{r.text}</p>
            <p className="text-xs text-muted">{r.reason}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
