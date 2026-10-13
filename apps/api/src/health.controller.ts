import { EntityManager } from '@mikro-orm/postgresql';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { JobQueue } from './generation/queue';

@Controller('health')
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    private readonly queue: JobQueue,
  ) {}

  @Get()
  async check() {
    try {
      await this.em.getConnection().execute('select 1');
      await this.queue.ping();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Dependencies unavailable');
    }
  }
}
