import 'reflect-metadata';
import { MikroORM } from '@mikro-orm/postgresql';
import { loadConfig } from '../config/config';
import { createOrmConfig } from '../database/mikro-orm.config';

/**
 * Run as a one-shot container before api/worker start, so two replicas never
 * race to migrate and a failed migration stops the rollout.
 */
async function main() {
  const { DATABASE_URL } = loadConfig();
  const orm = await MikroORM.init(createOrmConfig(DATABASE_URL));
  try {
    const executed = await orm.getMigrator().up();
    console.log(
      executed.length
        ? `Applied migrations: ${executed.map((m) => m.name).join(', ')}`
        : 'Database schema is up to date',
    );
  } finally {
    await orm.close(true);
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
