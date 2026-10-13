'use client';

import { PDF_MAX_BYTES, SOURCE_TEXT_MAX, SOURCE_TEXT_MIN, SourceTextSchema, TargetRoleSchema } from '@cvb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input, Textarea, cx } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Mode = 'pdf' | 'text';

export default function NewCvPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('pdf');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const targetRole = String(new FormData(e.currentTarget).get('targetRole') ?? '');
    const next: Record<string, string> = {};
    const role = TargetRoleSchema.safeParse(targetRole);
    if (!role.success) next.targetRole = role.error.issues[0]!.message;
    if (mode === 'pdf') {
      if (!file) next.file = 'Choose a PDF file';
      else if (file.size > PDF_MAX_BYTES) next.file = 'PDF is too large (max 5 MB)';
    } else {
      const t = SourceTextSchema.safeParse(text);
      if (!t.success) next.text = t.error.issues[0]!.message;
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const form = new FormData();
    form.set('targetRole', targetRole);
    if (mode === 'pdf') form.set('file', file!);
    else form.set('text', text);

    setPending(true);
    setError(null);
    try {
      const cv = await api.createCv(form);
      qc.setQueryData(['cv', cv.id], cv);
      void qc.invalidateQueries({ queryKey: ['cvs'] });
      router.push(`/cvs/${cv.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New CV</h1>
        <p className="text-sm text-muted">
          We only use what you give us. Anything missing becomes a question for you — we never make things up.
        </p>
      </div>
      <Card>
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Target role" hint='For example "Senior Backend Engineer"' error={errors.targetRole}>
            <Input name="targetRole" maxLength={120} placeholder="Senior Backend Engineer" autoFocus />
          </Field>

          <div>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Your background</span>
            <div role="tablist" className="mb-3 inline-flex rounded-lg border border-line bg-canvas p-1">
              {(['pdf', 'text'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={cx('rounded-md px-3 py-1.5 text-sm', mode === m ? 'bg-surface font-medium shadow-sm' : 'text-muted')}
                >
                  {m === 'pdf' ? 'Upload PDF' : 'Describe in text'}
                </button>
              ))}
            </div>

            {mode === 'pdf' ? (
              <Field label="CV file (PDF, up to 5 MB)" error={errors.file}>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full rounded-lg border border-dashed border-line bg-canvas p-4 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-on-brand"
                />
              </Field>
            ) : (
              <Field
                label="About you"
                hint={`Roles, companies, dates, what you did and achieved, education, skills. ${text.length}/${SOURCE_TEXT_MAX}`}
                error={errors.text}
              >
                <Textarea
                  rows={12}
                  value={text}
                  maxLength={SOURCE_TEXT_MAX}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={`Jane Doe, jane@example.com, Kyiv\nBackend Developer at Acme (2019–now): built the payments API in Node.js…\nBSc Computer Science, KPI, 2015–2019\nSkills: TypeScript, PostgreSQL, AWS`}
                  minLength={SOURCE_TEXT_MIN}
                />
              </Field>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={pending} className="w-full sm:w-auto">
              Generate CV
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
