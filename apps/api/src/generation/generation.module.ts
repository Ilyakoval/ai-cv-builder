import { Module } from '@nestjs/common';
import { JobProcessor } from './job-processor';
import { CvPipeline } from './pipeline/cv-pipeline';
import { JobQueue } from './queue';
import { Sweeper } from './sweeper';
import { WorkerRunner } from './worker-runner';

/** Producer side, used by the HTTP API. */
@Module({
  providers: [JobQueue],
  exports: [JobQueue],
})
export class QueueModule {}

/** Consumer side, only loaded in the worker process. */
@Module({
  imports: [QueueModule],
  providers: [CvPipeline, JobProcessor, Sweeper, WorkerRunner],
  exports: [JobProcessor, CvPipeline],
})
export class WorkerModule {}
