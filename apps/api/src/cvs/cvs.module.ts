import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../generation/generation.module';
import { CvsController } from './cvs.controller';
import { CvsService } from './cvs.service';

@Module({
  imports: [AuthModule, QueueModule],
  controllers: [CvsController],
  providers: [CvsService],
})
export class CvsModule {}
