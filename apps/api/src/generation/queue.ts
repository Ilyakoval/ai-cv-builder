import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConnectionOptions, Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/config';

export const CV_QUEUE = 'cv-jobs';
/** Attempts per job, including the first one. */
export const JOB_ATTEMPTS = 3;

export interface CvQueuePayload {
  jobId: string;
}

export function redisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    // Required by BullMQ workers; lets ioredis wait for Redis instead of failing commands.
    maxRetriesPerRequest: null,
  };
}

/**
 * Thin producer. The queue only transports job ids — the job's truth lives in
 * Postgres (cv_jobs). BullMQ's jobId is our DB id, so enqueueing the same job
 * twice (API + sweeper) is a no-op.
 */
@Injectable()
export class JobQueue implements OnModuleDestroy {
  private readonly logger = new Logger(JobQueue.name);
  readonly queue: Queue<CvQueuePayload>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.queue = new Queue<CvQueuePayload>(CV_QUEUE, {
      connection: redisConnection(config.REDIS_URL),
      defaultJobOptions: {
        attempts: JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }

  async enqueue(jobId: string): Promise<boolean> {
    try {
      await this.queue.add('cv', { jobId }, { jobId });
      return true;
    } catch (err) {
      // Not fatal: the job row is committed and the sweeper will enqueue it.
      this.logger.warn(`Failed to enqueue job ${jobId}, sweeper will retry: ${(err as Error).message}`);
      return false;
    }
  }

  /** BullMQ's view of a job, or null if Redis no longer knows it. */
  async state(jobId: string): Promise<string | null> {
    const job = await this.queue.getJob(jobId);
    return job ? await job.getState() : null;
  }

  async ping(): Promise<void> {
    const client = await this.queue.client;
    await (client as unknown as { ping(): Promise<string> }).ping();
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
