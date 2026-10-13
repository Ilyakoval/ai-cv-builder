import { Migrator } from '@mikro-orm/migrations';
import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { ENTITIES } from './entities';

export function createOrmConfig(databaseUrl: string, opts: { debug?: boolean } = {}) {
  return defineConfig({
    driver: PostgreSqlDriver,
    clientUrl: databaseUrl,
    entities: ENTITIES,
    extensions: [Migrator],
    debug: opts.debug ?? false,
    // Explicit flushes only: a forgotten flush is a visible bug, a surprise
    // implicit write is not.
    allowGlobalContext: false,
    forceUtcTimezone: true,
    pool: { min: 0, max: 10 },
    migrations: {
      tableName: 'mikro_orm_migrations',
      path: __dirname + '/migrations',
      // Works both for compiled JS (dist) and ts-jest (src).
      glob: '!(*.d).{js,ts}',
      transactional: true,
      allOrNothing: true,
      snapshot: false,
    },
  });
}
