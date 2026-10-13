import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';

export default function CvsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </>
  );
}
