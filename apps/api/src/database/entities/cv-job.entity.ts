import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { JobStage, JobStatus, JobType } from '@cvb/shared';
import { randomUUID } from 'node:crypto';
import { Cv } from './cv.entity';
import { CvQuestion } from './cv-question.entity';

/**
 * Durable record of a background job. The queue (BullMQ/Redis) only carries
 * the job id; status, stage and errors live here so the UI can survive page
 * reloads, device switches and even a Redis flush (the sweeper re-enqueues).
 */
@Entity({ tableName: 'cv_jobs' })
@Index({ properties: ['status', 'updatedAt'] })
export class CvJob {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => Cv, { deleteRule: 'cascade', index: true })
  cv!: Cv;

  @Enum({ items: ['generate', 'apply_answer'], type: 'string' })
  type!: JobType;

  @Enum({ items: ['queued', 'running', 'succeeded', 'failed'], type: 'string' })
  status: JobStatus = 'queued';

  @Property({ type: 'string', length: 32, nullable: true })
  stage: JobStage | null = 'queued';

  @Property({ type: 'integer' })
  attempts: number = 0;

  /** User-safe error message (never a raw stack or provider payload). */
  @Property({ type: 'text', nullable: true })
  error: string | null = null;

  @ManyToOne(() => CvQuestion, { nullable: true, deleteRule: 'set null' })
  question: CvQuestion | null = null;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
