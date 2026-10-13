import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { WorkerModule as GenerationWorkerModule } from './generation/generation.module';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [ConfigModule, DatabaseModule, LlmModule, GenerationWorkerModule],
})
export class WorkerAppModule {}
