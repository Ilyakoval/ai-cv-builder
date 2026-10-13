import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './config/config';
import { WorkerAppModule } from './worker.module';

/** Separate process: slow LLM work never competes with HTTP requests, and scales independently. */
async function main() {
  const config = loadConfig();
  const app = await NestFactory.createApplicationContext(WorkerAppModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
  new Logger('Worker').log(`Worker running (LLM provider: ${config.LLM_PROVIDER}, model: ${config.ANTHROPIC_MODEL})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
