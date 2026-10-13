'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from './ui';

export function AppHeader() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 60_000 });

  async function logout() {
    await api.logout().catch(() => undefined);
    window.location.href = '/login';
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/cvs" className="text-sm font-semibold tracking-wide text-brand">
          AI CV BUILDER
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          {me.data && <span className="hidden truncate text-sm text-muted sm:inline">{me.data.email}</span>}
          <Button variant="ghost" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
