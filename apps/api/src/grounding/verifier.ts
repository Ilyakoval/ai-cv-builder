import { normalizePhone, type CvSection } from '@cvb/shared';
import type {
  Claim,
  ContactDraft,
  CvDraft,
  EducationDraft,
  ExperienceDraft,
  SkillGroupDraft,
  SummaryDraft,
} from '../generation/pipeline/draft';
import { Corpus, digitsOf, findUnsupportedTerms, isValidEvidence, tokenize } from './corpus';

/**
 * Post-generation fact check. The model is *asked* not to invent anything;
 * this module makes sure of it. Anything that cannot be traced back to the
 * user's source (or their answers) is removed and reported, never silently
 * kept.
 *
 * Rules, from strictest to loosest:
 *  - identity fields (name, employer, institution, job title, degree) must be
 *    made of words that appear in the source;
 *  - email / phone / links must appear in the source verbatim;
 *  - every number and proper noun in a bullet or summary must appear in the
 *    source;
 *  - every bullet must cite at least one quote that exists in the source;
 *  - skills must be named in the source.
 */

export interface Removal {
  section: CvSection;
  /** Index into experience[]/education[] of the draft being verified. */
  itemIndex: number | null;
  text: string;
  reason: string;
}

export interface VerifyContext {
  corpus: Corpus;
  /** Tokens of the target role: the summary may *name* the role it targets. */
  targetRoleTokens: Set<string>;
}

export function createContext(sourceText: string, targetRole: string): VerifyContext {
  return { corpus: new Corpus(sourceText), targetRoleTokens: new Set(tokenize(targetRole)) };
}

const allTokensSupported = (value: string, corpus: Corpus) => corpus.tokenCoverage(value) === 1;

function checkClaim(claim: Claim, corpus: Corpus): string | null {
  if (!claim.text) return null;
  const unsupported = findUnsupportedTerms(claim.text, corpus);
  if (unsupported.length) return `mentions ${unsupported.map((t) => `"${t}"`).join(', ')}, not found in your input`;
  if (!claim.evidence.some((q) => isValidEvidence(q, corpus))) return 'no supporting statement found in your input';
  return null;
}

function verifyClaims(
  claims: Claim[],
  ctx: VerifyContext,
  section: CvSection,
  itemIndex: number,
  removals: Removal[],
): Claim[] {
  const kept: Claim[] = [];
  for (const claim of claims) {
    if (!claim.text) continue;
    const reason = checkClaim(claim, ctx.corpus);
    if (reason) removals.push({ section, itemIndex, text: claim.text, reason });
    else kept.push(claim);
  }
  return kept;
}

function verifyDate(value: string, corpus: Corpus): boolean {
  return findUnsupportedTerms(value, corpus).length === 0 || /^(present|current|now)$/i.test(value.trim());
}

export function verifyContact(contact: ContactDraft, ctx: VerifyContext, removals: Removal[]): ContactDraft {
  const { corpus } = ctx;
  const drop = (field: string, value: string) => {
    removals.push({ section: 'contact', itemIndex: null, text: value, reason: `${field} not found in your input` });
    return '';
  };
  const out: ContactDraft = { ...contact, links: [] };

  if (contact.fullName && !allTokensSupported(contact.fullName, corpus)) out.fullName = drop('Name', contact.fullName);
  if (contact.email && !corpus.containsRaw(contact.email)) out.email = drop('Email', contact.email);
  if (contact.phone) {
    if (normalizePhone(contact.phone) === null) {
      removals.push({
        section: 'contact',
        itemIndex: null,
        text: contact.phone,
        reason: "doesn't look like a phone number",
      });
      out.phone = '';
    } else if (!corpus.containsDigitSequence(digitsOf(contact.phone))) {
      out.phone = drop('Phone', contact.phone);
    }
  }
  if (contact.location && !allTokensSupported(contact.location, corpus)) out.location = drop('Location', contact.location);

  for (const link of contact.links) {
    if (!link.url) continue;
    const bare = link.url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    if (corpus.containsPhrase(bare)) out.links.push(link);
    else drop('Link', link.url);
  }
  return out;
}

export function verifySummary(summary: SummaryDraft, ctx: VerifyContext, removals: Removal[]): SummaryDraft {
  // The summary is a synthesis, so we check it sentence by sentence for hard
  // facts instead of requiring a quote per sentence.
  const sentences = summary.text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const unsupported = findUnsupportedTerms(sentence, ctx.corpus, ctx.targetRoleTokens);
    if (unsupported.length) {
      removals.push({
        section: 'summary',
        itemIndex: null,
        text: sentence,
        reason: `mentions ${unsupported.map((t) => `"${t}"`).join(', ')}, not found in your input`,
      });
    } else {
      kept.push(sentence);
    }
  }
  return { text: kept.join(' '), evidence: summary.evidence };
}

/** Returns null when the whole item must go (its employer is not in the source). */
export function verifyExperienceItem(
  item: ExperienceDraft,
  index: number,
  ctx: VerifyContext,
  removals: Removal[],
): ExperienceDraft | null {
  const { corpus } = ctx;
  const label = [item.title, item.company].filter(Boolean).join(' at ') || 'Experience entry';
  if (item.company && !allTokensSupported(item.company, corpus)) {
    removals.push({ section: 'experience', itemIndex: index, text: label, reason: `employer "${item.company}" not found in your input` });
    return null;
  }
  const out: ExperienceDraft = { ...item };
  if (item.title && !allTokensSupported(item.title, corpus)) {
    removals.push({ section: 'experience', itemIndex: index, text: item.title, reason: 'job title differs from your input' });
    out.title = '';
  }
  if (item.location && !allTokensSupported(item.location, corpus)) out.location = '';
  if (item.startDate && !verifyDate(item.startDate, corpus)) {
    removals.push({ section: 'experience', itemIndex: index, text: item.startDate, reason: 'start date not found in your input' });
    out.startDate = '';
  }
  if (item.endDate && !verifyDate(item.endDate, corpus)) {
    removals.push({ section: 'experience', itemIndex: index, text: item.endDate, reason: 'end date not found in your input' });
    out.endDate = '';
  }
  out.bullets = verifyClaims(item.bullets, ctx, 'experience', index, removals);
  if (!out.company && !out.title && out.bullets.length === 0) return null;
  return out;
}

export function verifyEducationItem(
  item: EducationDraft,
  index: number,
  ctx: VerifyContext,
  removals: Removal[],
): EducationDraft | null {
  const { corpus } = ctx;
  if (item.institution && !allTokensSupported(item.institution, corpus)) {
    removals.push({ section: 'education', itemIndex: index, text: item.institution, reason: 'institution not found in your input' });
    return null;
  }
  const out: EducationDraft = { ...item };
  for (const field of ['degree', 'field'] as const) {
    if (item[field] && !allTokensSupported(item[field], corpus)) {
      removals.push({ section: 'education', itemIndex: index, text: item[field], reason: `${field} differs from your input` });
      out[field] = '';
    }
  }
  if (item.startDate && !verifyDate(item.startDate, corpus)) out.startDate = '';
  if (item.endDate && !verifyDate(item.endDate, corpus)) out.endDate = '';
  out.details = verifyClaims(item.details, ctx, 'education', index, removals);
  if (!out.institution && !out.degree && out.details.length === 0) return null;
  return out;
}

export function verifySkills(groups: SkillGroupDraft[], ctx: VerifyContext, removals: Removal[]): SkillGroupDraft[] {
  const dropped: string[] = [];
  const out: SkillGroupDraft[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const items = group.items.filter((skill) => {
      const key = skill.toLowerCase();
      if (!skill || seen.has(key)) return false;
      const ok = ctx.corpus.containsPhrase(skill) || allTokensSupported(skill, ctx.corpus);
      if (!ok) dropped.push(skill);
      else seen.add(key);
      return ok;
    });
    if (items.length) out.push({ name: group.name, items });
  }
  if (dropped.length) {
    removals.push({ section: 'skills', itemIndex: null, text: dropped.join(', '), reason: 'skills not mentioned in your input' });
  }
  return out;
}

export interface DraftVerification {
  draft: CvDraft;
  removals: Removal[];
  /** Maps verified experience/education positions back to the model's original indexes. */
  experienceIndexMap: number[];
  educationIndexMap: number[];
}

export function verifyDraft(draft: CvDraft, ctx: VerifyContext): DraftVerification {
  const removals: Removal[] = [];
  const experience: ExperienceDraft[] = [];
  const experienceIndexMap: number[] = [];
  draft.experience.forEach((item, i) => {
    const v = verifyExperienceItem(item, i, ctx, removals);
    if (v) {
      experience.push(v);
      experienceIndexMap.push(i);
    }
  });
  const education: EducationDraft[] = [];
  const educationIndexMap: number[] = [];
  draft.education.forEach((item, i) => {
    const v = verifyEducationItem(item, i, ctx, removals);
    if (v) {
      education.push(v);
      educationIndexMap.push(i);
    }
  });

  return {
    draft: {
      contact: verifyContact(draft.contact, ctx, removals),
      summary: verifySummary(draft.summary, ctx, removals),
      experience,
      education,
      skills: verifySkills(draft.skills, ctx, removals),
      questions: draft.questions,
    },
    removals,
    experienceIndexMap,
    educationIndexMap,
  };
}

/** Human-readable list of problems, fed back to the model on the repair pass. */
export function describeRemovals(removals: Removal[]): string {
  return removals
    .map((r) => {
      const where = r.itemIndex === null ? r.section : `${r.section}[${r.itemIndex}]`;
      return `- ${where}: "${r.text}" — ${r.reason}`;
    })
    .join('\n');
}
