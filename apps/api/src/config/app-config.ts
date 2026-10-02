import { z } from 'zod';

const postgresUrl = z
  .string()
  .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a PostgreSQL connection URL');

const httpUrl = z.string().refine((value) => /^https?:\/\//.test(value), 'must be an http(s) URL');

const positiveInteger = (defaultValue: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(defaultValue);

const TRUSTED_PROXY_ENTRY = /^(loopback|linklocal|uniquelocal|\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?|[0-9a-f:]+(\/\d{1,3})?)$/i;

export type TrustProxy = false | number | string[];

/**
 * `false` (no proxy), the number of proxies in front of the API, or the addresses/CIDRs/names of the
 * trusted proxies, comma-separated. `true` is refused: it would let any client forge X-Forwarded-For.
 */
function parseTrustProxy(value: string): TrustProxy | undefined {
  if (value === 'false') return false;
  if (/^\d{1,2}$/.test(value)) return Number(value);
  const entries = value.split(',').map((entry) => entry.trim());
  return entries.every((entry) => TRUSTED_PROXY_ENTRY.test(entry)) ? entries : undefined;
}

const trustProxySchema = z
  .string()
  .default('false')
  .transform((value, context): TrustProxy => {
    const parsed = parseTrustProxy(value.trim());
    if (parsed !== undefined) return parsed;
    context.addIssue({ code: 'custom', message: 'must be false, a number of proxies or a list of proxy addresses' });
    return z.NEVER;
  });

/** What every process needs: logging, database tuning, object storage. */
const commonSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  /** Interactive transaction timeout (Prisma's own default is 5 s). */
  DB_TX_TIMEOUT_MS: positiveInteger(10_000, 120_000),
  /** How long a transaction may wait for a free connection (Prisma's own default is 2 s). */
  DB_TX_MAX_WAIT_MS: positiveInteger(5_000, 60_000),
  /** How long a statement may wait for a row or table lock before the database cancels it (the request then answers 503). */
  DB_LOCK_TIMEOUT_MS: positiveInteger(5_000, 60_000),
  /** Connections of the runtime pool. */
  DB_POOL_MAX: positiveInteger(10, 200),
  /** S3-compatible object storage (SeaweedFS in development, R2 or S3 in production). */
  STORAGE_ENDPOINT: httpUrl,
  /** The host browsers reach the storage at, when it differs from the one the servers use (presigned URLs). */
  STORAGE_PUBLIC_ENDPOINT: httpUrl.optional(),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_BUCKET: z.string().min(3),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  /** `true` for SeaweedFS and MinIO (bucket in the path); virtual-hosted style otherwise. */
  STORAGE_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

const apiSchema = commonSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65_535),
  /** Login of the `app_runtime` role: subject to row-level security. */
  DATABASE_URL: postgresUrl,
  /** Login of the `app_platform` role: bypasses row-level security. Only the API's platform services use it. */
  PLATFORM_DATABASE_URL: postgresUrl,
  /** Signing key of the access and selection tokens (HS256): at least 32 bytes. */
  JWT_SECRET: z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'must be at least 32 bytes long'),
  /** Which proxies may set X-Forwarded-For; the client IP (rate limits, sessions) depends on it. */
  TRUST_PROXY: trustProxySchema,
});

const workerSchema = commonSchema.extend({
  /** Login of the `app_worker` role: subject to row-level security, the only one that claims outbox events. */
  WORKER_DATABASE_URL: postgresUrl,
});

/**
 * What both processes inject: `DATABASE_URL` is the connection of the process's own role (`app_runtime` for the API,
 * `app_worker` for the worker, taken from `WORKER_DATABASE_URL`).
 */
export type AppConfig = z.infer<typeof commonSchema> & { readonly DATABASE_URL: string };

/** The API only: the worker listens on nothing, signs no tokens and never carries the BYPASSRLS platform login. */
export type ApiConfig = AppConfig & Pick<z.infer<typeof apiSchema>, 'PORT' | 'JWT_SECRET' | 'TRUST_PROXY' | 'PLATFORM_DATABASE_URL'>;

export type EntryPoint = 'api' | 'worker';

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

/** Never prints a value, only the variable name and the rule it broke. */
function parseOrThrow<S extends z.ZodType>(schema: S, env: Environment): z.infer<S> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map((issue) => {
      const variable = String(issue.path[0]);
      return env[variable] === undefined ? `${variable} is required` : `${variable} ${issue.message}`;
    }),
  );
}

/** Reads and validates the API's environment; the process must not start when it throws. */
export function loadApiConfig(env: Environment): ApiConfig {
  return parseOrThrow(apiSchema, env);
}

/** Reads and validates the worker's environment. It never reads `PORT`, `JWT_SECRET`, `DATABASE_URL` or the platform login. */
export function loadWorkerConfig(env: Environment): AppConfig {
  const { WORKER_DATABASE_URL, ...common } = parseOrThrow(workerSchema, env);
  return { ...common, DATABASE_URL: WORKER_DATABASE_URL };
}
