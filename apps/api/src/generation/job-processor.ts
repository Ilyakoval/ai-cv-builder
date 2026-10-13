import { EntityManager, MikroORM, raw } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import type { JobStage, RemovedClaimDto } from '@cvb/shared';
import { UnrecoverableError } from 'bullmq';
import { ZodError } from 'zod';
import { Cv, CvJob, CvQuestion } from '../database/entities';
import { LlmFatalError, LlmOutputError, LlmTransientError } from '../llm/llm.types';
import { applySectionChange, changeTarget, SectionConflictError } from './pipeline/assemble';
import { CvPipeline, ItemNotFoundError } from './pipeline/cv-pipeline';
import type { AnsweredQuestion } from './pipeline/prompts';

const MAX_REMOVED_CLAIMS = 50;

/** Errors a later attempt can plausibly fix. Everything else fails the job immediately. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof LlmFatalError || err instanceof SectionConflictError || err instanceof ItemNotFoundError) return false;
  if (err instanceof ZodError) return false;
  return true; // transient LLM errors, malformed output, DB/network blips
}

/** Never show raw provider/DB errors to users. */
export function userMessage(err: unknown, final: boolean): string {
  if (err instanceof SectionConflictError || err instanceof ItemNotFoundError) return err.message + ' Your answer is saved — submit it again to apply it.';
  if (err instanceof LlmFatalError) return 'The AI service rejected this request. Please try again later or contact support.';
  if (err instanceof LlmTransientError) return final ? 'The AI service is busy right now. Please try again in a few minutes.' : 'The AI service is busy — retrying…';
  if (err instanceof LlmOutputError) return final ? 'The AI returned an unusable result. Please try again.' : 'Got an unusable result from the AI — retrying…';
  return final ? 'Something went wrong while processing. Please try again.' : 'Temporary problem — retrying…';
}

export interface AttemptInfo {
  /** Attempts already made before this one (BullMQ attemptsMade). */
  made: number;
  max: number;
}

@Injectable()
export class JobProcessor {
  private readonly logger = new Logger(JobProcessor.name);

  constructor(
    private readonly orm: MikroORM,
    private readonly pipeline: CvPipeline,
  ) {}

  async process(jobId: string, attempt: AttemptInfo): Promise<void> {
    const em = this.orm.em.fork();
    const job = await em.findOne(CvJob, jobId, { populate: ['cv', 'cv.sourceText', 'question'] });
    if (!job) {
      this.logger.warn(`Job ${jobId} no longer exists (CV deleted?) — skipping`);
      return;
    }
    if (job.status === 'succeeded' || job.status === 'failed') {
      // Duplicate delivery (sweeper + queue); the work is already done.
      return;
    }

    job.status = 'running';
    job.attempts += 1;
    job.error = null;
    job.stage = 'reading_source';
    await em.flush();

    const started = Date.now();
    try {
      if (job.type === 'generate') await this.runGenerate(em, job);
      else await this.runApplyAnswer(em, job);
      this.logger.log(`Job ${job.id} (${job.type}) succeeded in ${Date.now() - started}ms`);
    } catch (err) {
      const final = !isRetryable(err) || attempt.made + 1 >= attempt.max;
      this.logger.error(
        `Job ${job.id} (${job.type}) attempt ${attempt.made + 1}/${attempt.max} failed${final ? ' permanently' : ''}: ${(err as Error).message}`,
      );
      await this.recordFailure(job.id, err, final);
      if (final) throw new UnrecoverableError((err as Error).message);
      throw err;
    }
  }

  /** Called by the sweeper when a job is stuck and BullMQ has given up on it. */
  async failStuck(jobId: string, reason: string): Promise<void> {
    await this.recordFailure(jobId, new Error(reason), true);
  }

  private async runGenerate(em: EntityManager, job: CvJob): Promise<void> {
    const cv = job.cv;
    const answers = await this.answeredQuestions(em, cv);
    const result = await this.pipeline.generate({
      targetRole: cv.targetRole,
      sourceText: cv.sourceText,
      answers,
      onStage: (stage) => this.setStage(em, job, stage),
    });

    await this.setStage(em, job, 'saving');
    await em.transactional(async (tx) => {
      // Questions from a previous generation no longer match the new item ids.
      // Answered ones stay: their answers are part of the grounding corpus.
      await tx.nativeDelete(CvQuestion, { cv: cv.id, status: { $in: ['open', 'applying', 'dismissed'] } });
      for (const q of result.questions) tx.create(CvQuestion, { cv: cv.id, ...q });
      await tx.nativeUpdate(
        Cv,
        { id: cv.id },
        {
          document: result.document,
          removedClaims: result.removals.map(toRemovedClaim).slice(0, MAX_REMOVED_CLAIMS),
          status: 'ready',
          // Atomic increment: a concurrent user save must never end up with the same version number.
          version: raw('version + 1'),
          updatedAt: new Date(),
        },
      );
      await tx.nativeUpdate(CvJob, { id: job.id }, { status: 'succeeded', stage: null, error: null, updatedAt: new Date() });
    });
  }

  private async runApplyAnswer(em: EntityManager, job: CvJob): Promise<void> {
    const question = job.question;
    if (!question || !question.answer) throw new ItemNotFoundError('The question for this job no longer exists.');
    const cv = job.cv;
    if (!cv.document) throw new ItemNotFoundError('This CV has no content yet.');

    const snapshot = cv.document;
    const answers = (await this.answeredQuestions(em, cv)).filter((a) => a.question !== question.question);
    await this.setStage(em, job, 'drafting');
    const { change, removals } = await this.pipeline.applyAnswer({
      targetRole: cv.targetRole,
      sourceText: cv.sourceText,
      answers,
      document: snapshot,
      section: question.section,
      itemId: question.itemId,
      question: question.question,
      answer: question.answer,
    });
    await this.setStage(em, job, 'saving');

    // Optimistic merge: re-read, make sure the user did not edit the part we
    // are about to replace, then write with a version check. Retry if
    // something else (an edit elsewhere, another answer) bumped the version.
    for (let i = 0; i < 5; i++) {
      const fresh = await em.fork().findOneOrFail(Cv, cv.id);
      if (!fresh.document) throw new ItemNotFoundError('This CV has no content yet.');
      if (changeTarget(fresh.document, change) !== changeTarget(snapshot, change)) throw new SectionConflictError();

      const merged = applySectionChange(fresh.document, change);
      const updated = await em.transactional(async (tx) => {
        const rows = await tx.nativeUpdate(
          Cv,
          { id: cv.id, version: fresh.version },
          {
            document: merged,
            version: fresh.version + 1,
            removedClaims: [...fresh.removedClaims, ...removals.map(toRemovedClaim)].slice(-MAX_REMOVED_CLAIMS),
            updatedAt: new Date(),
          },
        );
        if (rows === 0) return false;
        await tx.nativeUpdate(CvQuestion, { id: question.id }, { status: 'answered', updatedAt: new Date() });
        await tx.nativeUpdate(CvJob, { id: job.id }, { status: 'succeeded', stage: null, error: null, updatedAt: new Date() });
        return true;
      });
      if (updated) return;
    }
    throw new SectionConflictError();
  }

  private async recordFailure(jobId: string, err: unknown, final: boolean): Promise<void> {
    const em = this.orm.em.fork();
    const job = await em.findOne(CvJob, jobId, { populate: ['cv', 'question'] });
    if (!job) return;
    await em.transactional(async (tx) => {
      await tx.nativeUpdate(
        CvJob,
        { id: job.id },
        { status: final ? 'failed' : 'queued', stage: final ? null : 'queued', error: userMessage(err, final), updatedAt: new Date() },
      );
      if (!final) return;
      if (job.type === 'generate') {
        await tx.nativeUpdate(Cv, { id: job.cv.id, status: 'generating' }, { status: 'failed', updatedAt: new Date() });
      } else if (job.question) {
        // Give the question back to the user, keeping their answer as a draft.
        await tx.nativeUpdate(CvQuestion, { id: job.question.id, status: 'applying' }, { status: 'open', updatedAt: new Date() });
      }
    });
  }

  private async setStage(em: EntityManager, job: CvJob, stage: JobStage) {
    await em.nativeUpdate(CvJob, { id: job.id }, { stage, updatedAt: new Date() });
  }

  private async answeredQuestions(em: EntityManager, cv: Cv): Promise<AnsweredQuestion[]> {
    const rows = await em.find(
      CvQuestion,
      { cv: cv.id, status: { $in: ['answered', 'applying'] }, answer: { $ne: null } },
      { orderBy: { updatedAt: 'asc' } },
    );
    return rows.map((q) => ({ question: q.question, answer: q.answer! }));
  }
}

function toRemovedClaim(r: { section: RemovedClaimDto['section']; itemId: string | null; text: string; reason: string }): RemovedClaimDto {
  return { section: r.section, itemId: r.itemId, text: r.text, reason: r.reason };
}
