import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

// Defaults match docker-compose.test.yml; override via env to use another DB.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://cvbuilder:cvbuilder@127.0.0.1:5433/cvbuilder_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/1';
process.env.LLM_PROVIDER = 'fake';
process.env.MAX_ACTIVE_JOBS_PER_USER ??= '3';

/* eslint-disable import/first */
import { createApp } from '../src/bootstrap';
import { CvJob } from '../src/database/entities';
import { createOrmConfig } from '../src/database/mikro-orm.config';
import { JobProcessor } from '../src/generation/job-processor';
import { JobQueue } from '../src/generation/queue';
import { Sweeper } from '../src/generation/sweeper';
import { WorkerRunner } from '../src/generation/worker-runner';
import { LLM_CLIENT } from '../src/llm/llm.types';
import { WorkerAppModule } from '../src/worker.module';
import { ScriptedLlm } from './scripted-llm';

export interface Harness {
  app: NestFastifyApplication;
  llm: ScriptedLlm;
  orm: MikroORM;
  processor: JobProcessor;
  /** Runs every queued job synchronously, as the worker would. Returns how many ran. */
  drainJobs(attempt?: { made: number; max: number }): Promise<number>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const migrator = await MikroORM.init(createOrmConfig(process.env.DATABASE_URL!));
  await migrator.getMigrator().up();
  await migrator.close(true);

  const app = await createApp({ logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const llm = new ScriptedLlm();
  // The real worker module, minus the BullMQ consumer and the timer: tests
  // drive jobs explicitly so they are deterministic.
  const workerModule = await Test.createTestingModule({ imports: [WorkerAppModule] })
    .overrideProvider(LLM_CLIENT)
    .useValue(llm)
    .overrideProvider(WorkerRunner)
    .useValue({})
    .overrideProvider(Sweeper)
    .useValue({})
    .setLogger({ log() {}, warn() {}, error() {}, debug() {}, verbose() {}, fatal() {} })
    .compile();
  const worker = await workerModule.init();
  const processor = worker.get(JobProcessor);
  const orm = worker.get(MikroORM) as unknown as MikroORM;
  const queue = app.get(JobQueue);

  return {
    app,
    llm,
    orm,
    processor,
    async drainJobs(attempt = { made: 0, max: 3 }) {
      const jobs = await orm.em.fork().find(CvJob, { status: 'queued' }, { orderBy: { createdAt: 'asc' } });
      for (const job of jobs) {
        await processor.process(job.id, attempt).catch(() => undefined);
      }
      return jobs.length;
    },
    async reset() {
      llm.reset();
      await orm.em.getConnection().execute('truncate table users, sessions, cvs, cv_questions, cv_jobs cascade');
      await queue.queue.obliterate({ force: true });
    },
    async close() {
      await worker.close();
      await app.close();
    },
  };
}

// ---------- HTTP helpers ----------

export async function signup(app: NestFastifyApplication, email: string, password = 'correct-horse-1') {
  // Auth routes are rate limited per client IP; give each test user its own.
  const ip = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password }, headers: { 'x-forwarded-for': ip } });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'cvb_session')!;
  return { cookie: `cvb_session=${cookie.value}`, user: res.json() as { id: string; email: string } };
}

export function multipart(fields: Record<string, string>, file?: { name: string; content: Buffer; type?: string }) {
  const boundary = `----cvb${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/pdf'}\r\n\r\n`,
      ),
      file.content,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
