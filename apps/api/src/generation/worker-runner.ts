import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Worker } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/config';
import { JobProcessor } from './job-processor';
import { CV_QUEUE, CvQueuePayload, JOB_ATTEMPTS, redisConnection } from './queue';

@Injectable()
export class WorkerRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerRunner.name);
  private worker?: Worker<CvQueuePayload>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly processor: JobProcessor,
  ) {}

  onApplicationBootstrap() {
    this.worker = new Worker<CvQueuePayload>(
      CV_QUEUE,
      (job) => this.processor.process(job.data.jobId, { made: job.attemptsMade, max: job.opts.attempts ?? JOB_ATTEMPTS }),
      {
        connection: redisConnection(this.config.REDIS_URL),
        concurrency: this.config.WORKER_CONCURRENCY,
        // An LLM call can legitimately take minutes; keep the lock alive meanwhile.
        lockDuration: 60_000,
        maxStalledCount: 1,
      },
    );
    this.worker.on('error', (err) => this.logger.error(`Worker error: ${err.message}`));
    this.logger.log(`Worker started (concurrency ${this.config.WORKER_CONCURRENCY})`);
  }

  async onModuleDestroy() {
    // Waits for in-flight jobs to finish (graceful shutdown on SIGTERM).
    await this.worker?.close();
  }
}
