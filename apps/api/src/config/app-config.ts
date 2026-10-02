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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65_535),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']),
  /** Login of the `app_runtime` role: subject to row-level security. Used by the API entry only. */
  DATABASE_URL: postgresUrl.optional(),
  /** Login of the `app_worker` role: subject to row-level security, the only one that claims outbox events. Worker entry only. */
  WORKER_DATABASE_URL: postgresUrl.optional(),
  /** Login of the `app_platform` role: bypasses row-level security. API entry only (platform services); the worker does not get it. */
  PLATFORM_DATABASE_URL: postgresUrl.optional(),
  /** Signing key of the access and selection tokens (HS256): at least 32 bytes. */
  JWT_SECRET: z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'must be at least 32 bytes long'),
  /** Which proxies may set X-Forwarded-For; the client IP (rate limits, sessions) depends on it. */
  TRUST_PROXY: trustProxySchema,
  /** Interactive transaction timeout (Prisma's own default is 5 s). */
  DB_TX_TIMEOUT_MS: positiveInteger(10_000, 120_000),
  /** How long a transaction may wait for a free connection (Prisma's own default is 2 s). */
  DB_TX_MAX_WAIT_MS: positiveInteger(5_000, 60_000),
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

type Env = z.infer<typeof envSchema>;

/**
 * `DATABASE_URL` is the connection of the entry point's own role: `app_runtime` for the API and
 * `app_worker` for the worker (taken from `WORKER_DATABASE_URL`). The API never reads the worker's
 * login and the worker never reads the API's.
 */
export type AppConfig = Omit<Env, 'DATABASE_URL' | 'WORKER_DATABASE_URL'> & { DATABASE_URL: string };

/** Login variables each entry point must have: the worker never receives the BYPASSRLS platform login. */
const REQUIRED_CONNECTIONS: Readonly<Record<EntryPoint, readonly (keyof Env)[]>> = {
  api: ['DATABASE_URL', 'PLATFORM_DATABASE_URL'],
  worker: ['WORKER_DATABASE_URL'],
};

export type EntryPoint = 'api' | 'worker';

const CONNECTION_VARIABLE: Readonly<Record<EntryPoint, 'DATABASE_URL' | 'WORKER_DATABASE_URL'>> = {
  api: 'DATABASE_URL',
  worker: 'WORKER_DATABASE_URL',
};

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Reads and validates the environment; the application must not start when it throws. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>, entry: EntryPoint = 'api'): AppConfig {
  const result = envSchema.safeParse(env);
  const connection = CONNECTION_VARIABLE[entry];
  const problems = [
    ...(result.success
      ? []
      : result.error.issues.map((issue) => {
          const variable = String(issue.path[0]);
          return env[variable] === undefined ? `${variable} is required` : `${variable} ${issue.message}`;
        })),
    ...REQUIRED_CONNECTIONS[entry].filter((variable) => env[variable] === undefined).map((variable) => `${variable} is required`),
  ];
  if (!result.success || problems.length > 0) throw new ConfigError(problems);

  const { DATABASE_URL: _api, WORKER_DATABASE_URL: _worker, PLATFORM_DATABASE_URL: platformUrl, ...rest } = result.data;
  // The worker never carries the platform login, even if it is set in its environment.
  return { ...rest, DATABASE_URL: result.data[connection]!, ...(entry === 'api' && platformUrl !== undefined ? { PLATFORM_DATABASE_URL: platformUrl } : {}) };
}
