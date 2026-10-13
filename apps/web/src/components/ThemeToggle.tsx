'use client';

import { useEffect, useState } from 'react';

type Mode = 'light' | 'dark' | 'system';

const NEXT: Record<Mode, Mode> = { light: 'dark', dark: 'system', system: 'light' };
const LABEL: Record<Mode, string> = { light: 'Light theme', dark: 'Dark theme', system: 'System theme' };

function apply(mode: Mode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function ThemeToggle() {
  // `null` until mounted: the server doesn't know the saved mode.
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    setMode(saved === 'light' || saved === 'dark' ? saved : 'system');
  }, []);

  // Follow OS changes while in system mode.
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const cycle = () => {
    const next = NEXT[mode ?? 'system'];
    setMode(next);
    if (next === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', next);
    apply(next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title={mode ? `${LABEL[mode]} — click to switch` : 'Theme'}
      aria-label={mode ? LABEL[mode] : 'Theme'}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-canvas hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {mode === 'light' && <SunIcon />}
      {mode === 'dark' && <MoonIcon />}
      {(mode === 'system' || mode === null) && <AutoIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

function AutoIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 22h8m-4-4v4" />
    </svg>
  );
}
