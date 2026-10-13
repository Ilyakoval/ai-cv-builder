import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CvJob } from '../database/entities';
import { JobProcessor } from './job-processor';
import { JobQueue } from './queue';

const INTERVAL_MS = 30_000;
const QUEUED_GRACE_MS = 30_000;
// Longer than the worst-case single LLM call including SDK retries.
const RUNNING_STALE_MS = 15 * 60_000;

/**
 * Reconciles Postgres (source of truth) with Redis (transport):
 *  - a job committed to the DB but never enqueued (Redis down, crash between
 *    commit and enqueue) gets enqueued;
 *  - a job BullMQ has lost or given up on while the DB still says it is in
 *    flight gets failed, so the user sees an error and a retry button instead
 *    of an endless spinner.
 * This is a lightweight transactional-outbox substitute.
 */
@Injectable()
export class Sweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(Sweeper.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly orm: MikroORM,
    private readonly queue: JobQueue,
    private readonly processor: JobProcessor,
  ) {}

  onApplicationBootstrap() {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async sweep(now = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const em = this.orm.em.fork();
      const queued = await em.find(CvJob, { status: 'queued', updatedAt: { $lt: new Date(now - QUEUED_GRACE_MS) } }, { limit: 100 });
      for (const job of queued) {
        const state = await this.queue.state(job.id);
        if (state === null) {
          this.logger.warn(`Re-enqueueing orphaned job ${job.id}`);
          await this.queue.enqueue(job.id);
        } else if (state === 'failed' || state === 'completed') {
          await this.processor.failStuck(job.id, `queue reports ${state} but job was never finished`);
        }
      }

      const running = await em.find(CvJob, { status: 'running', updatedAt: { $lt: new Date(now - RUNNING_STALE_MS) } }, { limit: 100 });
      for (const job of running) {
        const state = await this.queue.state(job.id);
        if (state === null || state === 'failed' || state === 'completed') {
          this.logger.warn(`Failing stuck job ${job.id} (queue state: ${state ?? 'missing'})`);
          await this.processor.failStuck(job.id, 'job was interrupted');
        }
      }
    } catch (err) {
      this.logger.error(`Sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
