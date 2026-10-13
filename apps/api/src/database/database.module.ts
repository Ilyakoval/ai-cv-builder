import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { createOrmConfig } from './mikro-orm.config';

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createOrmConfig(config.DATABASE_URL),
      driver: PostgreSqlDriver,
    }),
  ],
})
export class DatabaseModule {}
