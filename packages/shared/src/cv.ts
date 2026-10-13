import { z } from 'zod';

/**
 * The CV document is the single source of truth for both the editor (web) and
 * the API. Every write — from the LLM pipeline or from a user edit — goes
 * through `CvDocumentSchema`, so limits and sanitisation live in one place.
 */

// C0/C1 control characters except \n and \t, plus zero-width / bidi overrides
// that can be used to visually spoof content in the rendered CV.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

export function sanitizeText(value: string): string {
  return value.replace(UNSAFE_CHARS, '').replace(/[ \t]+/g, ' ').trim();
}

/** Single-line text field with a hard length limit. */
export const text = (max: number) =>
  z
    .string()
    .transform((v) => sanitizeText(v).replace(/\s*\n\s*/g, ' '))
    .pipe(z.string().max(max, `Must be at most ${max} characters`));

/** Multi-line text (keeps line breaks, collapses runs of blank lines). */
export const longText = (max: number) =>
  z
    .string()
    .transform((v) => sanitizeText(v).replace(/\n{3,}/g, '\n\n'))
    .pipe(z.string().max(max, `Must be at most ${max} characters`));

/**
 * Only http(s) and mailto links survive. Bare domains ("github.com/me") get an
 * https:// prefix. Anything else (javascript:, data:, file:) is rejected so it
 * can never reach an <a href> in the editor or a link in the PDF.
 */
export function normalizeUrl(raw: string): string | null {
  const value = sanitizeText(raw);
  if (!value) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'mailto:') return url.toString();
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const urlField = z
  .string()
  .max(300)
  .transform((v, ctx) => {
    const normalized = normalizeUrl(v);
    if (normalized === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be an http(s) or mailto link' });
      return z.NEVER;
    }
    return normalized;
  });

const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Invalid id');

export const LinkSchema = z.object({
  label: text(40),
  url: urlField,
});

export const ContactSchema = z.object({
  fullName: text(120),
  email: text(200),
  phone: text(50),
  location: text(120),
  links: z.array(LinkSchema).max(8),
});

export const ExperienceItemSchema = z.object({
  id,
  title: text(120),
  company: text(120),
  location: text(120),
  startDate: text(30),
  endDate: text(30),
  bullets: z.array(text(400)).max(12),
});

export const EducationItemSchema = z.object({
  id,
  institution: text(160),
  degree: text(160),
  field: text(160),
  startDate: text(30),
  endDate: text(30),
  details: z.array(text(300)).max(6),
});

export const SkillGroupSchema = z.object({
  id,
  name: text(60),
  items: z.array(text(60)).max(40),
});

export const CvDocumentSchema = z.object({
  contact: ContactSchema,
  summary: longText(1500),
  experience: z.array(ExperienceItemSchema).max(20),
  education: z.array(EducationItemSchema).max(10),
  skills: z.array(SkillGroupSchema).max(12),
});

export type CvLink = z.infer<typeof LinkSchema>;
export type CvContact = z.infer<typeof ContactSchema>;
export type CvExperienceItem = z.infer<typeof ExperienceItemSchema>;
export type CvEducationItem = z.infer<typeof EducationItemSchema>;
export type CvSkillGroup = z.infer<typeof SkillGroupSchema>;
export type CvDocument = z.infer<typeof CvDocumentSchema>;

export const CV_SECTIONS = ['contact', 'summary', 'experience', 'education', 'skills'] as const;
export type CvSection = (typeof CV_SECTIONS)[number];

export function emptyCvDocument(): CvDocument {
  return {
    contact: { fullName: '', email: '', phone: '', location: '', links: [] },
    summary: '',
    experience: [],
    education: [],
    skills: [],
  };
}
