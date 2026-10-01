import { z } from 'zod';

const postgresUrl = z
  .string()
  .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a PostgreSQL connection URL');

const positiveInteger = (defaultValue: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(defaultValue);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65_535),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  /** Login of the `app_runtime` role: subject to row-level security. */
  DATABASE_URL: postgresUrl,
  /** Login of the `app_platform` role: bypasses row-level security. Platform services only. */
  PLATFORM_DATABASE_URL: postgresUrl,
  /** Signing key of the access and selection tokens (HS256): at least 32 bytes. */
  JWT_SECRET: z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'must be at least 32 bytes long'),
  /** Interactive transaction timeout (Prisma's own default is 5 s). */
  DB_TX_TIMEOUT_MS: positiveInteger(10_000, 120_000),
  /** How long a transaction may wait for a free connection (Prisma's own default is 2 s). */
  DB_TX_MAX_WAIT_MS: positiveInteger(5_000, 60_000),
  /** Connections of the runtime pool. */
  DB_POOL_MAX: positiveInteger(10, 200),
});

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Reads and validates the environment; the application must not start when it throws. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const result = envSchema.safeParse(env);
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map((issue) => {
      const variable = String(issue.path[0]);
      return env[variable] === undefined ? `${variable} is required` : `${variable} ${issue.message}`;
    }),
  );
}
