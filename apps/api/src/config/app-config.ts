import { z } from 'zod';
import { KEY_ID_PATTERN, type KeyringKey } from '../infrastructure/crypto/aes-gcm-keyring.js';

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

/**
 * `id:base64` pairs separated by commas; the first key encrypts and every key decrypts (rotation: prepend a new key and
 * keep the old one until no secret uses it). Each key is 32 random bytes (`openssl rand -base64 32`).
 */
const mfaKeyringSchema = z.string().transform((value, context): readonly KeyringKey[] => {
  const keys: KeyringKey[] = [];
  const problem = (message: string) => {
    context.addIssue({ code: 'custom', message });
    return z.NEVER;
  };
  for (const entry of value.split(',').map((item) => item.trim())) {
    const separator = entry.indexOf(':');
    const id = entry.slice(0, separator);
    const encoded = entry.slice(separator + 1);
    if (separator < 0 || !KEY_ID_PATTERN.test(id)) return problem('must be a comma-separated list of id:base64 (id: letters, digits, - or _, up to 32 characters)');
    if (keys.some((key) => key.id === id)) return problem('has a repeated key id');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encoded) return problem('keys must be base64 of exactly 32 bytes');
    keys.push({ id, key });
  }
  return keys;
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

const booleanFlag = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');

const boundedInteger = (defaultValue: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(defaultValue);

/** Exact origins (scheme, host and port, lower case), comma-separated: what the WebSocket handshake compares `Origin` with. */
const originsSchema = z.string().transform((value, context): readonly string[] => {
  const origins: string[] = [];
  for (const entry of value.split(',').map((item) => item.trim()).filter((item) => item.length > 0)) {
    try {
      const url = new URL(entry);
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin === 'null' || entry.replace(/\/$/, '').toLowerCase() !== url.origin) throw new Error('not an origin');
      origins.push(url.origin);
    } catch {
      context.addIssue({ code: 'custom', message: `must be a comma-separated list of origins such as https://app.example.com (no path): ${JSON.stringify(entry)} is not` });
      return z.NEVER;
    }
  }
  return origins;
});

const apiSchema = commonSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65_535),
  /** Login of the `app_runtime` role: subject to row-level security. */
  DATABASE_URL: postgresUrl,
  /** Login of the `app_platform` role: bypasses row-level security. Only the API's platform services use it. */
  PLATFORM_DATABASE_URL: postgresUrl,
  /** Signing key of the access and selection tokens (HS256): at least 32 bytes. */
  JWT_SECRET: z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'must be at least 32 bytes long'),
  /** AES-256 keys of the stored MFA secrets. Only the API decrypts them: the worker never receives this variable. */
  MFA_ENCRYPTION_KEYS: mfaKeyringSchema,
  /** Which proxies may set X-Forwarded-For; the client IP (rate limits, sessions) depends on it. */
  TRUST_PROXY: trustProxySchema,
  /** The WebSocket gateway (`/realtime`) and its listener of worker signals. `false`: neither exists. */
  REALTIME_ENABLED: booleanFlag(true),
  /** The listener's own connection (`LISTEN` needs a session: direct, or PgBouncer in session mode). Defaults to `DATABASE_URL`. */
  REALTIME_DATABASE_URL: postgresUrl.optional(),
  /** Origins allowed to open a socket. Required when the gateway is enabled; `https://` in production. */
  REALTIME_ALLOWED_ORIGINS: originsSchema.optional(),
  REALTIME_MAX_CONNECTIONS: boundedInteger(5_000, 1, 50_000),
  REALTIME_MAX_CONNECTIONS_PER_USER: boundedInteger(10, 1, 50),
  REALTIME_MAX_TICKET_SUBSCRIPTIONS: boundedInteger(20, 1, 100),
  REALTIME_REVALIDATE_INTERVAL_MS: boundedInteger(60_000, 10_000, 600_000),
  REALTIME_AUTH_GRACE_MS: boundedInteger(10_000, 1_000, 60_000),
  REALTIME_DB_CONCURRENCY: boundedInteger(4, 1, 32),
  REALTIME_SIGNAL_QUEUE_MAX: boundedInteger(10_000, 100, 1_000_000),
});

/** Rules that involve several variables. */
function apiRules(config: z.infer<typeof apiSchema>, context: z.RefinementCtx): void {
  if (config.REALTIME_ENABLED && (config.REALTIME_ALLOWED_ORIGINS === undefined || config.REALTIME_ALLOWED_ORIGINS.length === 0)) {
    context.addIssue({ code: 'custom', path: ['REALTIME_ALLOWED_ORIGINS'], message: 'is required when REALTIME_ENABLED is true (the origins allowed to open a socket)' });
  }
  if (config.NODE_ENV === 'production' && config.REALTIME_ENABLED && (config.REALTIME_ALLOWED_ORIGINS ?? []).some((origin) => !origin.startsWith('https://'))) {
    context.addIssue({ code: 'custom', path: ['REALTIME_ALLOWED_ORIGINS'], message: 'must use https:// in production' });
  }
  // (A pool size that already failed its own rule is not reported twice.)
  if (config.REALTIME_ENABLED && config.DB_POOL_MAX >= 1 && config.REALTIME_DB_CONCURRENCY >= config.DB_POOL_MAX) {
    context.addIssue({ code: 'custom', path: ['REALTIME_DB_CONCURRENCY'], message: `must be lower than DB_POOL_MAX (${config.DB_POOL_MAX}) so that the HTTP requests keep connections` });
  }
}

const apiSchemaChecked = apiSchema.superRefine(apiRules);

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
export type ApiConfig = AppConfig &
  Pick<
    z.infer<typeof apiSchema>,
    | 'PORT'
    | 'JWT_SECRET'
    | 'TRUST_PROXY'
    | 'PLATFORM_DATABASE_URL'
    | 'MFA_ENCRYPTION_KEYS'
    | 'REALTIME_ENABLED'
    | 'REALTIME_DATABASE_URL'
    | 'REALTIME_ALLOWED_ORIGINS'
    | 'REALTIME_MAX_CONNECTIONS'
    | 'REALTIME_MAX_CONNECTIONS_PER_USER'
    | 'REALTIME_MAX_TICKET_SUBSCRIPTIONS'
    | 'REALTIME_REVALIDATE_INTERVAL_MS'
    | 'REALTIME_AUTH_GRACE_MS'
    | 'REALTIME_DB_CONCURRENCY'
    | 'REALTIME_SIGNAL_QUEUE_MAX'
  >;

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

/**
 * Whether the API registers its real-time modules at all. Module registration happens before the configuration provider
 * runs, so this reads the raw variable; the value is still validated with the rest (anything but `true`/`false` stops the
 * process), and the default is the schema's (`true`).
 */
export function realtimeEnabledIn(env: Environment): boolean {
  return env.REALTIME_ENABLED !== 'false';
}

/** Reads and validates the API's environment; the process must not start when it throws. */
export function loadApiConfig(env: Environment): ApiConfig {
  return parseOrThrow(apiSchemaChecked, env);
}

/** Reads and validates the worker's environment. It never reads `PORT`, `JWT_SECRET`, `DATABASE_URL` or the platform login. */
export function loadWorkerConfig(env: Environment): AppConfig {
  const { WORKER_DATABASE_URL, ...common } = parseOrThrow(workerSchema, env);
  return { ...common, DATABASE_URL: WORKER_DATABASE_URL };
}
