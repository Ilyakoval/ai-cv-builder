import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { loadConfig } from './config/config';

async function main() {
  const config = loadConfig();
  const app = await createApp();
  await app.listen(config.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${config.PORT} (LLM provider: ${config.LLM_PROVIDER})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
