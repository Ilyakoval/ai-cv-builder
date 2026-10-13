import { z } from 'zod';
import { CV_SECTIONS, CvDocument, CvDocumentSchema, CvSection, text } from './cv';

// ---------- Requests ----------

export const CredentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .email('Enter a valid email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
});
export type Credentials = z.infer<typeof CredentialsSchema>;

export const TARGET_ROLE_MAX = 120;
export const SOURCE_TEXT_MIN = 50;
export const SOURCE_TEXT_MAX = 30_000;
export const PDF_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_PAGES = 10;

export const TargetRoleSchema = text(TARGET_ROLE_MAX).pipe(
  z.string().min(2, 'Target role is required'),
);

export const SourceTextSchema = z
  .string()
  .trim()
  .min(SOURCE_TEXT_MIN, `Tell us a bit more — at least ${SOURCE_TEXT_MIN} characters`)
  .max(SOURCE_TEXT_MAX, `Text is too long (max ${SOURCE_TEXT_MAX} characters)`);

export const UpdateDocumentSchema = z.object({
  version: z.number().int().nonnegative(),
  document: CvDocumentSchema,
});
export type UpdateDocumentInput = z.input<typeof UpdateDocumentSchema>;

export const UpdateCvMetaSchema = z.object({
  title: text(120).pipe(z.string().min(1, 'Title is required')),
});

export const AnswerQuestionSchema = z.object({
  answer: z
    .string()
    .trim()
    .min(1, 'Answer is required')
    .max(2000, 'Answer is too long (max 2000 characters)'),
});

// ---------- Responses ----------

export type CvStatus = 'generating' | 'ready' | 'failed';
export type JobType = 'generate' | 'apply_answer';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobStage = 'queued' | 'reading_source' | 'drafting' | 'verifying' | 'saving';
export type QuestionStatus = 'open' | 'applying' | 'answered' | 'dismissed';

export interface UserDto {
  id: string;
  email: string;
}

export interface JobDto {
  id: string;
  type: JobType;
  status: JobStatus;
  stage: JobStage | null;
  error: string | null;
  questionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionDto {
  id: string;
  section: CvSection;
  itemId: string | null;
  question: string;
  status: QuestionStatus;
  answer: string | null;
  origin: 'model' | 'verifier';
  createdAt: string;
}

/** A claim the verifier removed because it could not be traced to the source. */
export interface RemovedClaimDto {
  section: CvSection;
  itemId: string | null;
  text: string;
  reason: string;
}

export interface CvSummaryDto {
  id: string;
  title: string;
  targetRole: string;
  status: CvStatus;
  openQuestions: number;
  createdAt: string;
  updatedAt: string;
}

export interface CvDetailDto extends CvSummaryDto {
  version: number;
  sourceType: 'pdf' | 'text';
  sourceFileName: string | null;
  document: CvDocument | null;
  questions: QuestionDto[];
  removedClaims: RemovedClaimDto[];
  /** Most recent jobs first; the UI uses this to show progress and errors. */
  jobs: JobDto[];
}

export interface ApiErrorDto {
  statusCode: number;
  error: string;
  message: string;
  details?: { path: string; message: string }[];
}

export const QuestionSectionSchema = z.enum(CV_SECTIONS);
