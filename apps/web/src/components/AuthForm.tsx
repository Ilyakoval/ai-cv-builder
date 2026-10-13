'use client';

import { CredentialsSchema } from '@cvb/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from './ui';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = CredentialsSchema.safeParse({ email: form.get('email'), password: form.get('password') });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setFieldErrors({});
    setError(null);
    setPending(true);
    try {
      if (mode === 'login') await api.login(parsed.data.email, parsed.data.password);
      else await api.signup(parsed.data.email, parsed.data.password);
      const next = params.get('next');
      // Only allow same-site relative redirects.
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/cvs');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setPending(false);
    }
  }

  const isLogin = mode === 'login';
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-sm font-semibold tracking-wide text-brand">AI CV BUILDER</p>
        <h1 className="mt-2 text-2xl font-semibold">{isLogin ? 'Welcome back' : 'Create your account'}</h1>
        <p className="mt-1 text-sm text-muted">Your CVs are saved to your account and available on any device.</p>
      </div>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" error={fieldErrors.email}>
            <Input name="email" type="email" autoComplete="email" required autoFocus />
          </Field>
          <Field label="Password" hint={isLogin ? undefined : 'At least 8 characters'} error={fieldErrors.password}>
            <Input name="password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} required minLength={8} />
          </Field>
          <Button type="submit" className="w-full" loading={pending}>
            {isLogin ? 'Sign in' : 'Create account'}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-muted">
        {isLogin ? 'No account yet? ' : 'Already have an account? '}
        <Link className="font-medium text-accent hover:underline" href={isLogin ? '/signup' : '/login'}>
          {isLogin ? 'Sign up' : 'Sign in'}
        </Link>
      </p>
    </main>
  );
}
