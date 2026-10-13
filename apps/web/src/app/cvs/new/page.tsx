'use client';

import { PDF_MAX_BYTES, SOURCE_TEXT_MAX, SOURCE_TEXT_MIN, SourceTextSchema, TargetRoleSchema } from '@cvb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input, Textarea, cx } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Mode = 'pdf' | 'text';

export default function NewCvPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('pdf');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
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
              /* Custom control instead of a native file input: the native button's
                 label is browser-localized and can't be styled or translated. */
              <div>
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">CV file (PDF, up to 5 MB)</span>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const dropped = e.dataTransfer.files?.[0];
                    if (dropped) setFile(dropped);
                  }}
                  className={cx(
                    'flex w-full flex-col items-center gap-1 rounded-xl border border-dashed p-6 text-sm transition',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    dragOver ? 'border-accent bg-info-soft' : 'border-line bg-canvas hover:border-accent/50',
                  )}
                >
                  {file ? (
                    <>
                      <span className="font-medium">{file.name}</span>
                      <span className="text-xs text-muted">
                        {file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`} · click to
                        choose another file
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-brand">Choose a PDF file</span>
                      <span className="text-xs text-muted">or drag and drop it here</span>
                    </>
                  )}
                </button>
                {errors.file && <span className="mt-1 block text-xs text-danger">{errors.file}</span>}
              </div>
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
