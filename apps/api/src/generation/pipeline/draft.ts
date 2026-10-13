import { CV_SECTIONS, sanitizeText } from '@cvb/shared';
import { z } from 'zod';

/**
 * Shape the LLM must produce. Two representations of the same contract:
 *  - JSON Schema, sent to the model as the tool's input_schema;
 *  - a zod schema, used to *parse* what comes back.
 *
 * The zod side is deliberately lenient about cosmetic problems (null instead
 * of "", over-long strings, extra items — we coerce, truncate and cap) and
 * strict about structure. Facts are checked separately by the verifier.
 */

const str = (max: number) =>
  z.preprocess((v) => (v == null ? '' : typeof v === 'number' ? String(v) : v), z.string()).transform((v) =>
    sanitizeText(v).replace(/\s*\n\s*/g, ' ').slice(0, max),
  );

const list = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.preprocess((v) => (v == null ? [] : v), z.array(item)).transform((arr) => arr.slice(0, max));

const ClaimSchema = z.preprocess(
  (v) => (typeof v === 'string' ? { text: v, evidence: [] } : v),
  z.object({
    text: str(400),
    evidence: list(str(600), 5),
  }),
);

const QuestionSchema = z.object({
  section: z.enum(CV_SECTIONS).catch('summary'),
  itemIndex: z.preprocess((v) => (v == null ? null : v), z.number().int().min(0).nullable()).catch(null),
  question: str(300),
});

export const ContactDraftSchema = z.object({
  fullName: str(120),
  email: str(200),
  phone: str(50),
  location: str(120),
  links: list(z.object({ label: str(40), url: str(300) }), 8),
});

export const ExperienceDraftSchema = z.object({
  title: str(120),
  company: str(120),
  location: str(120),
  startDate: str(30),
  endDate: str(30),
  relevance: z.coerce.number().min(0).max(10).catch(5),
  bullets: list(ClaimSchema, 12),
});

export const EducationDraftSchema = z.object({
  institution: str(160),
  degree: str(160),
  field: str(160),
  startDate: str(30),
  endDate: str(30),
  details: list(ClaimSchema, 6),
});

export const SkillGroupDraftSchema = z.object({
  name: str(60),
  items: list(str(60), 40),
});

export const SummaryDraftSchema = z.preprocess(
  (v) => (typeof v === 'string' ? { text: v, evidence: [] } : v ?? { text: '', evidence: [] }),
  z.object({ text: z.preprocess((v) => v ?? '', z.string()).transform((v) => sanitizeText(v).slice(0, 1500)), evidence: list(str(600), 8) }),
);

export const CvDraftSchema = z.object({
  contact: ContactDraftSchema,
  summary: SummaryDraftSchema,
  experience: list(ExperienceDraftSchema, 20),
  education: list(EducationDraftSchema, 10),
  skills: list(SkillGroupDraftSchema, 12),
  questions: list(QuestionSchema, 10),
});

export type Claim = z.output<typeof ClaimSchema>;
export type ContactDraft = z.output<typeof ContactDraftSchema>;
export type ExperienceDraft = z.output<typeof ExperienceDraftSchema>;
export type EducationDraft = z.output<typeof EducationDraftSchema>;
export type SkillGroupDraft = z.output<typeof SkillGroupDraftSchema>;
export type SummaryDraft = z.output<typeof SummaryDraftSchema>;
export type CvDraft = z.output<typeof CvDraftSchema>;
export type DraftQuestion = z.output<typeof QuestionSchema>;

// ---------------- JSON Schemas for the tool definitions ----------------

const S = { type: 'string' } as const;
const evidence = {
  type: 'array',
  items: S,
  description: 'Verbatim quotes copied from <source> or <candidate_answers> that support this text.',
} as const;
const claim = {
  type: 'object',
  properties: { text: S, evidence },
  required: ['text', 'evidence'],
} as const;

export const contactJsonSchema = {
  type: 'object',
  properties: {
    fullName: S,
    email: S,
    phone: S,
    location: S,
    links: {
      type: 'array',
      items: { type: 'object', properties: { label: S, url: S }, required: ['label', 'url'] },
    },
  },
  required: ['fullName', 'email', 'phone', 'location', 'links'],
} as const;

export const experienceJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Job title exactly as written in the source.' },
    company: { type: 'string', description: 'Employer exactly as written in the source.' },
    location: S,
    startDate: { type: 'string', description: 'As written in the source, e.g. "2021-03" or "Mar 2021". Empty if unknown.' },
    endDate: { type: 'string', description: 'As written in the source, or "Present". Empty if unknown.' },
    relevance: { type: 'integer', minimum: 0, maximum: 10, description: 'Relevance to the target role.' },
    bullets: { type: 'array', items: claim },
  },
  required: ['title', 'company', 'location', 'startDate', 'endDate', 'relevance', 'bullets'],
} as const;

export const educationJsonSchema = {
  type: 'object',
  properties: {
    institution: S,
    degree: S,
    field: S,
    startDate: S,
    endDate: S,
    details: { type: 'array', items: claim },
  },
  required: ['institution', 'degree', 'field', 'startDate', 'endDate', 'details'],
} as const;

export const skillsJsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Group name, e.g. "Languages".' }, items: { type: 'array', items: S } },
    required: ['name', 'items'],
  },
} as const;

export const summaryJsonSchema = claim;

export const questionsJsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      section: { type: 'string', enum: [...CV_SECTIONS] },
      itemIndex: {
        type: ['integer', 'null'],
        description: 'Index into experience[] or education[] when the question is about one item; otherwise null.',
      },
      question: { type: 'string', description: 'One short, specific question addressed to the candidate.' },
    },
    required: ['section', 'itemIndex', 'question'],
  },
} as const;

export const cvDraftJsonSchema = {
  type: 'object',
  properties: {
    contact: contactJsonSchema,
    summary: summaryJsonSchema,
    experience: { type: 'array', items: experienceJsonSchema },
    education: { type: 'array', items: educationJsonSchema },
    skills: skillsJsonSchema,
    questions: questionsJsonSchema,
  },
  required: ['contact', 'summary', 'experience', 'education', 'skills', 'questions'],
} as const;
