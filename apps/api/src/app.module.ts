import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ConfigModule } from './config/config.module';
import { CvsModule } from './cvs/cvs.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './generation/generation.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, QueueModule, AuthModule, CvsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
