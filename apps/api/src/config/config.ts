import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z
  .object({
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
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'is required when LLM_PROVIDER=anthropic (set LLM_PROVIDER=fake to run without a key)',
      });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Fail fast at boot with a readable message instead of failing on first use. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
