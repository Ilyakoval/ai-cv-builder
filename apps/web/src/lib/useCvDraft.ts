'use client';

import { CvDetailDto, CvDocument, CvDocumentSchema } from '@cvb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error' | 'conflict';

const AUTOSAVE_MS = 1000;

/** Drops blank bullets/skills the user left while typing; trims list items. */
export function cleanForSave(doc: CvDocument): CvDocument {
  const lines = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  return {
    ...doc,
    contact: { ...doc.contact, links: doc.contact.links.filter((l) => l.url.trim() || l.label.trim()) },
    experience: doc.experience.map((e) => ({ ...e, bullets: lines(e.bullets) })),
    education: doc.education.map((e) => ({ ...e, details: lines(e.details) })),
    skills: doc.skills.map((g) => ({ ...g, items: lines(g.items) })).filter((g) => g.name.trim() || g.items.length),
  };
}

/**
 * Local editable copy of the CV with debounced autosave and optimistic
 * concurrency: every save carries the version it was based on; a 409 means
 * someone else (another tab/device, or an applied answer) wrote in between,
 * and we stop instead of overwriting their change.
 */
export function useCvDraft(cv: CvDetailDto | undefined) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<CvDocument | null>(null);
  const [state, setState] = useState<SaveState>('idle');
  const [issues, setIssues] = useState<string[]>([]);

  const latest = useRef<CvDocument | null>(null);
  const version = useRef<number>(0);
  const dirty = useRef(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Adopt server state when we have nothing local to protect.
  useEffect(() => {
    if (!cv?.document) return;
    if (!dirty.current && !inFlight.current && cv.version >= version.current) {
      latest.current = cv.document;
      version.current = cv.version;
      setDraft(cv.document);
    }
  }, [cv?.document, cv?.version]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!cv || !latest.current) return true;
    if (inFlight.current) await inFlight.current;
    if (!dirty.current) return true;

    const doc = cleanForSave(latest.current);
    const parsed = CvDocumentSchema.safeParse(doc);
    if (!parsed.success) {
      setIssues(parsed.error.issues.slice(0, 5).map((i) => `${humanPath(i.path)}: ${i.message}`));
      setState('invalid');
      return false;
    }
    setIssues([]);
    setState('saving');
    const sent = latest.current;
    const run = (async () => {
      try {
        const updated = await api.saveDocument(cv.id, version.current, parsed.data);
        version.current = updated.version;
        if (latest.current === sent) dirty.current = false;
        qc.setQueryData(['cv', cv.id], updated);
        setState(dirty.current ? 'pending' : 'saved');
        return true;
      } catch (err) {
        setState(err instanceof ApiError && err.status === 409 ? 'conflict' : 'error');
        return false;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    const ok = await run;
    if (ok && dirty.current) schedule();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cv?.id, qc]);

  const saveRef = useRef(save);
  saveRef.current = save;
  // Stable across renders; always calls the latest `save`.
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), AUTOSAVE_MS);
  }, []);

  const update = useCallback(
    (fn: (d: CvDocument) => CvDocument) => {
      if (!latest.current) return;
      const next = fn(latest.current);
      latest.current = next;
      dirty.current = true;
      setDraft(next);
      setState((s) => (s === 'conflict' ? s : 'pending'));
      schedule();
    },
    [schedule],
  );

  /** Save now (before download / answering a question). Resolves false if it could not be saved. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    return save();
  }, [save]);

  /** Throw away local edits and take the server's latest version. */
  const reloadLatest = useCallback(async () => {
    if (!cv) return;
    clearTimeout(timer.current);
    const fresh = await api.getCv(cv.id);
    dirty.current = false;
    latest.current = fresh.document;
    version.current = fresh.version;
    setDraft(fresh.document);
    setState('idle');
    qc.setQueryData(['cv', cv.id], fresh);
  }, [cv, qc]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { draft, update, flush, reloadLatest, state, issues };
}

function humanPath(path: (string | number)[]): string {
  return path
    .map((p) => (typeof p === 'number' ? `#${p + 1}` : p.replace(/([A-Z])/g, ' $1').toLowerCase()))
    .join(' › ');
}
