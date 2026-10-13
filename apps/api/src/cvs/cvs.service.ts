import { EntityManager, UniqueConstraintViolationException } from '@mikro-orm/postgresql';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CvDetailDto, CvDocument, CvSummaryDto, JobDto, QuestionDto } from '@cvb/shared';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Cv, CvJob, CvQuestion, User } from '../database/entities';
import { JobQueue } from '../generation/queue';

export interface CreateCvInput {
  targetRole: string;
  sourceType: 'pdf' | 'text';
  sourceText: string;
  sourceFileName: string | null;
}

/**
 * Every query is scoped by owner. A CV that exists but belongs to someone else
 * is indistinguishable from one that does not exist (404, not 403), so ids
 * cannot be probed.
 */
@Injectable()
export class CvsService {
  constructor(
    private readonly em: EntityManager,
    private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(user: User): Promise<CvSummaryDto[]> {
    const cvs = await this.em.find(
      Cv,
      { owner: user.id },
      { orderBy: { updatedAt: 'desc' }, fields: ['id', 'title', 'targetRole', 'status', 'createdAt', 'updatedAt'], limit: 200 },
    );
    const counts = await this.openQuestionCounts(cvs.map((c) => c.id));
    return cvs.map((cv) => toSummary(cv, counts.get(cv.id) ?? 0));
  }

  async create(user: User, input: CreateCvInput): Promise<CvDetailDto> {
    await this.assertJobCapacity(user);
    const cv = this.em.create(Cv, {
      owner: user,
      title: input.targetRole,
      targetRole: input.targetRole,
      sourceType: input.sourceType,
      sourceText: input.sourceText,
      sourceFileName: input.sourceFileName,
    });
    const job = this.em.create(CvJob, { cv, type: 'generate' });
    await this.em.flush();
    // After commit: if this fails, the sweeper enqueues the job later.
    await this.queue.enqueue(job.id);
    return this.get(user, cv.id);
  }

  async get(user: User, id: string): Promise<CvDetailDto> {
    const cv = await this.findOwned(user, id);
    const [questions, jobs] = await Promise.all([
      this.em.find(CvQuestion, { cv: cv.id }, { orderBy: { createdAt: 'asc' } }),
      this.em.find(CvJob, { cv: cv.id }, { orderBy: { createdAt: 'desc' }, limit: 10, populate: [] }),
    ]);
    const openQuestions = questions.filter((q) => q.status === 'open').length;
    return {
      ...toSummary(cv, openQuestions),
      version: cv.version,
      sourceType: cv.sourceType,
      sourceFileName: cv.sourceFileName,
      document: cv.document,
      removedClaims: cv.removedClaims,
      questions: questions.filter((q) => q.status !== 'dismissed').map(toQuestionDto),
      jobs: jobs.map(toJobDto),
    };
  }

  async updateDocument(user: User, id: string, version: number, document: CvDocument): Promise<CvDetailDto> {
    const cv = await this.findOwned(user, id);
    if (!cv.document) throw new ConflictException('The CV is still being generated');
    const rows = await this.em.nativeUpdate(
      Cv,
      { id: cv.id, owner: user.id, version },
      { document, version: version + 1, updatedAt: new Date() },
    );
    if (rows === 0) {
      throw new ConflictException('This CV was changed elsewhere (another tab, device, or an applied answer). Reload to get the latest version.');
    }
    this.em.clear();
    return this.get(user, id);
  }

  async rename(user: User, id: string, title: string): Promise<CvDetailDto> {
    const cv = await this.findOwned(user, id);
    await this.em.nativeUpdate(Cv, { id: cv.id }, { title, updatedAt: new Date() });
    this.em.clear();
    return this.get(user, id);
  }

  async remove(user: User, id: string): Promise<void> {
    const cv = await this.findOwned(user, id);
    // FK cascades remove questions and jobs; a worker that picks up a job of a
    // deleted CV just skips it.
    await this.em.nativeDelete(Cv, { id: cv.id, owner: user.id });
  }

  async regenerate(user: User, id: string): Promise<CvDetailDto> {
    const cv = await this.findOwned(user, id);
    await this.assertJobCapacity(user);
    const job = this.em.create(CvJob, { cv, type: 'generate' });
    cv.status = 'generating';
    try {
      await this.em.flush();
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) throw new ConflictException('Generation is already in progress');
      throw err;
    }
    await this.queue.enqueue(job.id);
    return this.get(user, id);
  }

  async answerQuestion(user: User, id: string, questionId: string, answer: string): Promise<CvDetailDto> {
    const cv = await this.findOwned(user, id);
    if (!cv.document || cv.status === 'generating') throw new ConflictException('Wait for the CV to finish generating');
    const question = await this.findQuestion(cv, questionId);
    if (question.status !== 'open') throw new ConflictException('This question has already been answered');
    await this.assertJobCapacity(user);

    question.answer = answer;
    question.status = 'applying';
    const job = this.em.create(CvJob, { cv, type: 'apply_answer', question });
    try {
      await this.em.flush();
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) throw new ConflictException('This answer is already being applied');
      throw err;
    }
    await this.queue.enqueue(job.id);
    return this.get(user, id);
  }

  async dismissQuestion(user: User, id: string, questionId: string): Promise<CvDetailDto> {
    const cv = await this.findOwned(user, id);
    const question = await this.findQuestion(cv, questionId);
    if (question.status !== 'open') throw new ConflictException('Only open questions can be dismissed');
    question.status = 'dismissed';
    await this.em.flush();
    return this.get(user, id);
  }

  async findOwned(user: User, id: string): Promise<Cv> {
    const cv = await this.em.findOne(Cv, { id, owner: user.id });
    if (!cv) throw new NotFoundException('CV not found');
    return cv;
  }

  private async findQuestion(cv: Cv, questionId: string): Promise<CvQuestion> {
    const q = await this.em.findOne(CvQuestion, { id: questionId, cv: cv.id });
    if (!q) throw new NotFoundException('Question not found');
    return q;
  }

  /** LLM calls cost money: cap how much work one account can have in flight. */
  private async assertJobCapacity(user: User) {
    const active = await this.em.count(CvJob, { cv: { owner: user.id }, status: { $in: ['queued', 'running'] } });
    if (active >= this.config.MAX_ACTIVE_JOBS_PER_USER) {
      throw new HttpException('You have too many CVs being processed. Wait for them to finish.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async openQuestionCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows: { cv_id: string; n: string }[] = await this.em
      .getConnection()
      .execute(`select cv_id, count(*) as n from cv_questions where status = 'open' and cv_id in (${ids.map(() => '?').join(',')}) group by cv_id`, ids);
    return new Map(rows.map((r) => [r.cv_id, Number(r.n)]));
  }
}

function toSummary(
  cv: Pick<Cv, 'id' | 'title' | 'targetRole' | 'status' | 'createdAt' | 'updatedAt'>,
  openQuestions: number,
): CvSummaryDto {
  return {
    id: cv.id,
    title: cv.title,
    targetRole: cv.targetRole,
    status: cv.status,
    openQuestions,
    createdAt: cv.createdAt.toISOString(),
    updatedAt: cv.updatedAt.toISOString(),
  };
}

function toQuestionDto(q: CvQuestion): QuestionDto {
  return {
    id: q.id,
    section: q.section,
    itemId: q.itemId,
    question: q.question,
    status: q.status,
    answer: q.answer,
    origin: q.origin,
    createdAt: q.createdAt.toISOString(),
  };
}

function toJobDto(j: CvJob): JobDto {
  return {
    id: j.id,
    type: j.type,
    status: j.status,
    stage: j.stage,
    error: j.error,
    questionId: j.question?.id ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}
