import {
  CvDocument,
  CvDocumentSchema,
  CvEducationItem,
  CvExperienceItem,
  CvSection,
  CvSkillGroup,
  CvContact,
  normalizeUrl,
} from '@cvb/shared';
import { randomBytes } from 'node:crypto';
import { normalize } from '../../grounding/corpus';
import type { DraftVerification, Removal } from '../../grounding/verifier';
import type { ContactDraft, DraftQuestion, EducationDraft, ExperienceDraft, SkillGroupDraft } from './draft';

export const newItemId = (prefix: string) => `${prefix}_${randomBytes(6).toString('base64url')}`;

export function toContact(c: ContactDraft): CvContact {
  return {
    fullName: c.fullName,
    email: c.email,
    phone: c.phone,
    location: c.location,
    links: c.links
      .map((l) => ({ label: l.label || 'Link', url: normalizeUrl(l.url) }))
      .filter((l): l is { label: string; url: string } => !!l.url),
  };
}

export function toExperienceItem(e: ExperienceDraft, id = newItemId('exp')): CvExperienceItem {
  return {
    id,
    title: e.title,
    company: e.company,
    location: e.location,
    startDate: e.startDate,
    endDate: e.endDate,
    bullets: e.bullets.map((b) => b.text),
  };
}

export function toEducationItem(e: EducationDraft, id = newItemId('edu')): CvEducationItem {
  return {
    id,
    institution: e.institution,
    degree: e.degree,
    field: e.field,
    startDate: e.startDate,
    endDate: e.endDate,
    details: e.details.map((d) => d.text),
  };
}

export function toSkillGroups(groups: SkillGroupDraft[]): CvSkillGroup[] {
  return groups.map((g) => ({ id: newItemId('skl'), name: g.name || 'Skills', items: g.items }));
}

export interface PlannedQuestion {
  section: CvSection;
  itemId: string | null;
  question: string;
  origin: 'model' | 'verifier';
}

export interface AssembledCv {
  document: CvDocument;
  questions: PlannedQuestion[];
  removals: (Removal & { itemId: string | null })[];
}

const MAX_QUESTIONS = 10;
const MAX_VERIFIER_QUESTIONS = 3;

/**
 * Turns a verified draft into the stored document: assigns stable ids, puts
 * the most relevant experience first, and builds the question list from three
 * sources — the model's own questions, claims the verifier removed, and
 * required fields that ended up empty.
 */
export function assembleCv(verified: DraftVerification): AssembledCv {
  const { draft } = verified;

  // Stable sort: equal relevance keeps the source order (usually reverse-chronological).
  const experienceWithIdx = draft.experience.map((e, i) => ({ e, i, id: newItemId('exp') }));
  const ordered = [...experienceWithIdx].sort((a, b) => b.e.relevance - a.e.relevance || a.i - b.i);
  const education = draft.education.map((e) => ({ e, id: newItemId('edu') }));

  const expIdByOriginal = new Map<number, string>();
  experienceWithIdx.forEach(({ i, id }) => expIdByOriginal.set(verified.experienceIndexMap[i]!, id));
  const eduIdByOriginal = new Map<number, string>();
  education.forEach(({ id }, i) => eduIdByOriginal.set(verified.educationIndexMap[i]!, id));

  const itemIdFor = (section: CvSection, originalIndex: number | null): string | null => {
    if (originalIndex === null) return null;
    if (section === 'experience') return expIdByOriginal.get(originalIndex) ?? null;
    if (section === 'education') return eduIdByOriginal.get(originalIndex) ?? null;
    return null;
  };

  const document = CvDocumentSchema.parse({
    contact: toContact(draft.contact),
    summary: draft.summary.text,
    experience: ordered.map(({ e, id }) => toExperienceItem(e, id)),
    education: education.map(({ e, id }) => toEducationItem(e, id)),
    skills: toSkillGroups(draft.skills),
  });

  const removals = verified.removals.map((r) => ({ ...r, itemId: itemIdFor(r.section, r.itemIndex) }));

  const questions = planQuestions(draft.questions, removals, document, itemIdFor);
  return { document, questions, removals };
}

function planQuestions(
  modelQuestions: DraftQuestion[],
  removals: (Removal & { itemId: string | null })[],
  doc: CvDocument,
  itemIdFor: (section: CvSection, idx: number | null) => string | null,
): PlannedQuestion[] {
  const out: PlannedQuestion[] = [];
  const seen = new Set<string>();
  const add = (q: PlannedQuestion) => {
    const key = normalize(q.question);
    if (!key || seen.has(key) || out.length >= MAX_QUESTIONS) return;
    seen.add(key);
    out.push(q);
  };

  for (const q of modelQuestions) {
    add({ section: q.section, itemId: itemIdFor(q.section, q.itemIndex), question: q.question, origin: 'model' });
  }

  // Claims we removed become questions: the user can confirm them with facts.
  const removedBullets = removals.filter(
    (r) => (r.section === 'experience' || r.section === 'education' || r.section === 'summary') && r.text.length > 12,
  );
  for (const r of removedBullets.slice(0, MAX_VERIFIER_QUESTIONS)) {
    add({
      section: r.section,
      itemId: r.itemId,
      question: `We left out “${r.text}” because we couldn't find it in what you gave us (${r.reason}). If it's accurate, tell us the details and we'll add it.`,
      origin: 'verifier',
    });
  }

  // Required fields that are still empty and that nobody asked about yet.
  const asked = (section: CvSection, itemId: string | null = null) =>
    out.some((q) => q.section === section && (itemId === null || q.itemId === itemId));
  const c = doc.contact;
  const missingContact = [!c.fullName && 'full name', !c.email && 'email', !c.phone && 'phone number', !c.location && 'city/country'].filter(Boolean);
  if (missingContact.length && !asked('contact')) {
    add({ section: 'contact', itemId: null, question: `Which ${missingContact.join(', ')} should appear on your CV?`, origin: 'verifier' });
  }
  for (const e of doc.experience) {
    if ((!e.startDate || !e.endDate) && !asked('experience', e.id)) {
      const at = [e.title, e.company].filter(Boolean).join(' at ') || 'this role';
      add({ section: 'experience', itemId: e.id, question: `When did you start and finish as ${at}?`, origin: 'verifier' });
    }
  }
  if (doc.experience.length === 0 && !asked('experience')) {
    add({ section: 'experience', itemId: null, question: 'Tell us about your work experience: job title, company, dates and what you achieved.', origin: 'verifier' });
  }
  if (!doc.summary && !asked('summary')) {
    add({ section: 'summary', itemId: null, question: 'In one or two sentences, what are you strongest at that is relevant to this role?', origin: 'verifier' });
  }
  return out;
}

/** Flattens a document into plain text, so hand-edited content counts as the user's own words. */
export function documentToText(doc: CvDocument | null): string {
  if (!doc) return '';
  const lines: string[] = [];
  const c = doc.contact;
  lines.push(c.fullName, c.email, c.phone, c.location, ...c.links.map((l) => `${l.label} ${l.url}`));
  lines.push(doc.summary);
  for (const e of doc.experience) lines.push(e.title, e.company, e.location, e.startDate, e.endDate, ...e.bullets);
  for (const e of doc.education) lines.push(e.institution, e.degree, e.field, e.startDate, e.endDate, ...e.details);
  for (const g of doc.skills) lines.push(g.name, ...g.items);
  return lines.filter(Boolean).join('\n');
}

/**
 * A worker's write is expressed as the smallest possible change, so it can be
 * re-applied on top of a document the user edited in the meantime.
 */
export type SectionChange =
  | { kind: 'replace-section'; section: 'contact'; value: CvContact }
  | { kind: 'replace-section'; section: 'summary'; value: string }
  | { kind: 'replace-section'; section: 'skills'; value: CvSkillGroup[] }
  | { kind: 'replace-item'; section: 'experience'; itemId: string; item: CvExperienceItem }
  | { kind: 'replace-item'; section: 'education'; itemId: string; item: CvEducationItem }
  | { kind: 'append-items'; section: 'experience'; items: CvExperienceItem[] }
  | { kind: 'append-items'; section: 'education'; items: CvEducationItem[] };

export function applySectionChange(doc: CvDocument, change: SectionChange): CvDocument {
  switch (change.kind) {
    case 'replace-section':
      return { ...doc, [change.section]: change.value };
    case 'replace-item': {
      const list = doc[change.section] as { id: string }[];
      if (!list.some((i) => i.id === change.itemId)) throw new SectionConflictError();
      return { ...doc, [change.section]: list.map((i) => (i.id === change.itemId ? change.item : i)) };
    }
    case 'append-items':
      return { ...doc, [change.section]: [...doc[change.section], ...change.items] };
  }
}

/** The part of the document a change depends on; if it changed underneath us, we must not overwrite it. */
export function changeTarget(doc: CvDocument, change: Pick<SectionChange, 'kind' | 'section'> & { itemId?: string }): string {
  if (change.kind === 'append-items') return '';
  if (change.kind === 'replace-item') {
    const list = doc[change.section] as { id: string }[];
    return JSON.stringify(list.find((i) => i.id === change.itemId) ?? null);
  }
  return JSON.stringify(doc[change.section]);
}

export class SectionConflictError extends Error {
  override name = 'SectionConflictError';
  constructor() {
    super('This part of the CV was edited while we were applying your answer.');
  }
}
