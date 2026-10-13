'use client';

import type { CvDetailDto, CvDocument, JobDto, QuestionDto } from '@cvb/shared';
import { useState } from 'react';
import { Alert, Button, Spinner, Textarea } from './ui';

const SECTION_LABEL: Record<QuestionDto['section'], string> = {
  contact: 'Contact',
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
};

function itemLabel(doc: CvDocument | null, q: QuestionDto): string {
  if (!doc || !q.itemId) return SECTION_LABEL[q.section];
  const exp = doc.experience.find((e) => e.id === q.itemId);
  if (exp) return [exp.title, exp.company].filter(Boolean).join(' · ') || 'Experience';
  const edu = doc.education.find((e) => e.id === q.itemId);
  if (edu) return edu.institution || 'Education';
  return SECTION_LABEL[q.section];
}

export function QuestionsPanel({
  cv,
  onAnswer,
  onDismiss,
}: {
  cv: CvDetailDto;
  onAnswer: (q: QuestionDto, answer: string) => Promise<void>;
  onDismiss: (q: QuestionDto) => Promise<void>;
}) {
  const open = cv.questions.filter((q) => q.status === 'open' || q.status === 'applying');
  const answered = cv.questions.filter((q) => q.status === 'answered');
  const failedJobs = new Map<string, JobDto>();
  for (const j of cv.jobs) {
    // Latest job per question (jobs are newest first).
    if (j.type === 'apply_answer' && j.questionId && !failedJobs.has(j.questionId)) failedJobs.set(j.questionId, j);
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand">Questions for you</h2>
        <p className="mt-1 text-xs text-muted">
          We don&apos;t guess. Answer these to fill gaps — only the related part of the CV is updated.
        </p>
      </div>
      {open.length === 0 && (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No open questions. Edit anything directly in the CV.</p>
      )}
      {open.map((q) => (
        <QuestionCard
          key={q.id}
          q={q}
          label={itemLabel(cv.document, q)}
          lastJob={failedJobs.get(q.id)}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
        />
      ))}
      {answered.length > 0 && (
        <details className="rounded-lg border border-line bg-surface p-3 text-sm">
          <summary className="cursor-pointer text-muted">Answered ({answered.length})</summary>
          <ul className="mt-2 space-y-2">
            {answered.map((q) => (
              <li key={q.id}>
                <p className="text-muted">{q.question}</p>
                <p className="mt-0.5 whitespace-pre-wrap">{q.answer}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function QuestionCard({
  q,
  label,
  lastJob,
  onAnswer,
  onDismiss,
}: {
  q: QuestionDto;
  label: string;
  lastJob?: JobDto;
  onAnswer: (q: QuestionDto, answer: string) => Promise<void>;
  onDismiss: (q: QuestionDto) => Promise<void>;
}) {
  // A failed apply keeps the user's answer so they can resubmit it.
  const [answer, setAnswer] = useState(q.answer ?? '');
  const [busy, setBusy] = useState<'answer' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applying = q.status === 'applying';
  const failed = q.status === 'open' && lastJob?.status === 'failed';

  async function run(kind: 'answer' | 'dismiss') {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'answer') await onAnswer(q, answer.trim());
      else await onDismiss(q);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="rounded-xl border border-warn/30 bg-surface p-3 shadow-sm">
      <a
        href={q.itemId ? `#item-${q.itemId}` : `#section-${q.section}`}
        className="text-xs font-medium uppercase tracking-wide text-warn hover:underline"
      >
        {label}
      </a>
      <p className="mt-1 text-sm">{q.question}</p>
      {applying ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Spinner className="h-4 w-4" /> Updating your CV…
        </div>
      ) : (
        <>
          {failed && lastJob?.error && (
            <div className="mt-2">
              <Alert tone="warning">{lastJob.error}</Alert>
            </div>
          )}
          {error && (
            <div className="mt-2">
              <Alert>{error}</Alert>
            </div>
          )}
          <Textarea
            className="mt-2"
            rows={3}
            maxLength={2000}
            placeholder="Your answer"
            aria-label={`Answer: ${q.question}`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" loading={busy === 'dismiss'} disabled={!!busy} onClick={() => run('dismiss')}>
              Skip
            </Button>
            <Button loading={busy === 'answer'} disabled={!!busy || !answer.trim()} onClick={() => run('answer')}>
              {failed ? 'Try again' : 'Apply answer'}
            </Button>
          </div>
        </>
      )}
    </article>
  );
}
