import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    LLM_PROVIDER: z.enum(['anthropic', 'fake']).default('anthropic'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

    COOKIE_SECURE: bool.default('false'),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
    /** Max generation/apply jobs a single user may have in flight. */
    MAX_ACTIVE_JOBS_PER_USER: z.coerce.number().int().min(1).default(3),
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Fail fast at boot with a readable message instead of failing on first use.
 * Only the worker talks to the LLM, so only the worker needs the API key
 * (the HTTP API never sees it).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { requireLlm?: boolean } = {}): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  if (parsed.success && opts.requireLlm && parsed.data.LLM_PROVIDER === 'anthropic' && !parsed.data.ANTHROPIC_API_KEY) {
    issues.push('  - ANTHROPIC_API_KEY: is required when LLM_PROVIDER=anthropic (set LLM_PROVIDER=fake to run without a key)');
  }
  if (!parsed.success || issues.length) {
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return parsed.data;
}
