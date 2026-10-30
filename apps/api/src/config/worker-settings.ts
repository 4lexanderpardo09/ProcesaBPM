import { PDF_LIMITS } from '@procesabpm/shared';
import { z } from 'zod';
import { AI_EFFORTS, ANTHROPIC } from '../infrastructure/llm/anthropic-provider.js';
import { MULTIPART_MAX_PARTS, MULTIPART_PART_BYTES } from '../infrastructure/storage/s3-multipart-write.js';
import { ConfigError } from './app-config.js';

const httpUrl = z.string().refine((value) => /^https?:\/\//.test(value), 'must be an http(s) URL');
const boolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');
const positiveInteger = (defaultValue: number, max: number) => z.coerce.number().int().min(1).max(max).default(defaultValue);

const HOUR_MS = 60 * 60_000;
const GIB = 1024 ** 3;
/** 10 000 parts of 16 MiB: the largest object the export's multipart upload can write. */
const MAX_MULTIPART_OBJECT_BYTES = MULTIPART_MAX_PARTS * MULTIPART_PART_BYTES;

/** Worst case allowed for one batch: half of the 5-minute lease. */
const MAX_BATCH_PROCESSING_MS = 150_000;
/** With rendering included: the lease is 5 minutes and the last wave still has to record its result. */
const MAX_BATCH_WITH_RENDERING_MS = 270_000;
/** How long publishing one realtime signal (a post-commit effect) may take. */
export const SIGNAL_PUBLISH_TIMEOUT_MS = 5_000;
/** Post-commit effects of one event at most: a ticket event signals its notifications and the ticket itself. */
export const MAX_POST_COMMIT_EFFECTS_PER_EVENT = 2;
/** The effects run in the event's lane, after its commit: their time counts against the lease too. */
const POST_COMMIT_BUDGET_MS = MAX_POST_COMMIT_EFFECTS_PER_EVENT * SIGNAL_PUBLISH_TIMEOUT_MS;

/** How long a worker holds an AI request between heartbeats (renewed before every call to the provider). */
export const AI_JOB_LEASE_MS = 10 * 60_000;
/** A call must leave a minute of the lease to record its result. */
const AI_MAX_REQUEST_TIMEOUT_MS = AI_JOB_LEASE_MS - 60_000;

const settingsSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  /** Where the web app lives: the links in e-mails are built on it. */
  WEB_BASE_URL: httpUrl,
  /** HMAC key the worker derives the one-time tokens of e-mail links from. Only the worker has it. */
  OUTBOX_TOKEN_KEY: z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'must be at least 32 bytes long'),
  MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
  MAIL_FROM: z.string().min(3).default('ProcesaBPM <no-reply@procesabpm.local>'),
  MAIL_MESSAGE_ID_DOMAIN: z.string().min(3).default('procesabpm.local'),
  /** Where the website's demo requests are mailed; without it they are only listed in the platform console. */
  SALES_INBOX_EMAIL: z.preprocess((value) => (value === '' ? undefined : value), z.email().optional()),
  SMTP_HOST: z.string().min(1).optional(),
  /** A mail catcher (Mailpit) for the addresses reserved for testing (.test, .invalid, .example): they never go to SMTP_HOST. Empty: they are dropped. */
  MAIL_CATCHER_HOST: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional()),
  MAIL_CATCHER_PORT: positiveInteger(1025, 65_535),
  SMTP_PORT: positiveInteger(1025, 65_535),
  SMTP_SECURE: boolean(false),
  /** Empty counts as unset, so the compose file can always pass them (`${SMTP_USER:-}`) for a server without SMTP login. */
  SMTP_USER: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional()),
  SMTP_PASSWORD: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional()),
  /** Tell the API instances (through `NOTIFY`) that something changed, so they can update open screens. */
  REALTIME_SIGNALS_ENABLED: boolean(true),
  OUTBOX_POLLING_ENABLED: boolean(true),
  OUTBOX_POLL_INTERVAL_MS: positiveInteger(2_000, 600_000),
  OUTBOX_BATCH_SIZE: positiveInteger(10, 500),
  OUTBOX_CONCURRENCY: positiveInteger(4, 64),
  /** Timeout of the transactions that process an event (they must end well inside the claim's lease). */
  OUTBOX_TX_TIMEOUT_MS: positiveInteger(30_000, 240_000),
  /** How long drawing one PDF may take before the event fails for good. */
  PDF_RENDER_TIMEOUT_MS: positiveInteger(PDF_LIMITS.defaultRenderTimeoutMs, PDF_LIMITS.maxRenderTimeoutMs),
  PDF_MAX_OUTPUT_BYTES: positiveInteger(PDF_LIMITS.maxOutputBytes, 50 * 1024 * 1024),
  /** Time budget of one organization data export attempt (decision B16: 4 h); past it the export fails (EXPORT_TIMEOUT). */
  DATA_EXPORT_MAX_RUN_MS: positiveInteger(4 * HOUR_MS, 24 * HOUR_MS),
  /** Size cap of one export archive (decision B16: 100 GiB); past it the export fails (EXPORT_TOO_LARGE). */
  DATA_EXPORT_MAX_BYTES: positiveInteger(100 * GIB, MAX_MULTIPART_OBJECT_BYTES),
  /**
   * The AI assistant's provider: `anthropic` (Claude, through its own API) or the name of any OpenAI-compatible chat
   * API, which then needs AI_BASE_URL. Without a key, its requests fail AI_NOT_CONFIGURED.
   */
  AI_PROVIDER_NAME: z.string().regex(/^[a-z0-9-]{1,40}$/).default('anthropic'),
  /** Up to the version prefix for an OpenAI-compatible provider; for anthropic only to go through a proxy. Empty: unset. */
  AI_BASE_URL: z.preprocess((value) => (value === '' ? undefined : value), httpUrl.optional()),
  /** Empty means not configured, so the compose file can pass it through unset. */
  AI_API_KEY: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(20).optional()),
  /** The model that designs: any of the provider's, so a newer one is a change here (claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5…). */
  AI_REASONING_MODEL: z.string().regex(/^[A-Za-z0-9._:/-]{1,100}$/).default('claude-haiku-5-5'),
  /** How much Claude thinks before answering (anthropic only): more is slower and spends more tokens. */
  AI_EFFORT: z.enum(AI_EFFORTS).default('high'),
  /** Strict tool calling (the provider enforces the JSON Schema of the answer); OpenAI-compatible providers only. */
  AI_STRICT_TOOLS: boolean(true),
  /** One call to the provider; must end inside the job's lease. */
  AI_REQUEST_TIMEOUT_MS: positiveInteger(300_000, AI_MAX_REQUEST_TIMEOUT_MS),
  /** Calls per request: the first draft plus the corrections. */
  AI_MAX_ROUNDS: positiveInteger(3, 4),
  AI_POLLING_ENABLED: boolean(true),
  AI_POLL_INTERVAL_MS: positiveInteger(3_000, 60_000),
});

export type WorkerSettings = Omit<z.infer<typeof settingsSchema>, 'NODE_ENV'>;

export const WORKER_SETTINGS = Symbol('WORKER_SETTINGS');

/** What only the worker needs (e-mail, links, outbox tuning). The API never reads these variables. */
export function loadWorkerSettings(env: Readonly<Record<string, string | undefined>>): WorkerSettings {
  const result = settingsSchema.safeParse(env);
  const problems = result.success
    ? []
    : result.error.issues.map((issue) => {
        const variable = String(issue.path[0]);
        return env[variable] === undefined ? `${variable} is required` : `${variable} ${issue.message}`;
      });
  if (result.success) {
    const { data } = result;
    if (data.MAIL_TRANSPORT === 'smtp' && data.SMTP_HOST === undefined) problems.push('SMTP_HOST is required when MAIL_TRANSPORT is smtp');
    if (data.NODE_ENV === 'production' && data.MAIL_TRANSPORT === 'memory') problems.push('MAIL_TRANSPORT memory is not allowed in production');
    if (data.NODE_ENV === 'production' && !data.WEB_BASE_URL.startsWith('https://')) problems.push('WEB_BASE_URL must be https in production');
    // Events are claimed for 5 minutes and processed in waves: the slowest wave must end well inside the lease.
    const waves = Math.ceil(data.OUTBOX_BATCH_SIZE / data.OUTBOX_CONCURRENCY);
    const effects = data.REALTIME_SIGNALS_ENABLED ? POST_COMMIT_BUDGET_MS : 0;
    if (waves * (data.OUTBOX_TX_TIMEOUT_MS + effects) > MAX_BATCH_PROCESSING_MS) problems.push('OUTBOX_BATCH_SIZE / OUTBOX_CONCURRENCY waves of OUTBOX_TX_TIMEOUT_MS (plus the realtime signals after commit) would outlive the claim lease');
    else if (waves * (data.OUTBOX_TX_TIMEOUT_MS + data.PDF_RENDER_TIMEOUT_MS + effects) > MAX_BATCH_WITH_RENDERING_MS) problems.push('OUTBOX_BATCH_SIZE / OUTBOX_CONCURRENCY waves of OUTBOX_TX_TIMEOUT_MS plus PDF_RENDER_TIMEOUT_MS (plus the realtime signals after commit) would outlive the claim lease');
    if ((data.SMTP_USER === undefined) !== (data.SMTP_PASSWORD === undefined)) problems.push('SMTP_USER and SMTP_PASSWORD go together');
    if (data.AI_PROVIDER_NAME !== ANTHROPIC && data.AI_BASE_URL === undefined) problems.push('AI_BASE_URL is required for an OpenAI-compatible provider');
    if (data.NODE_ENV === 'production' && data.AI_BASE_URL !== undefined && !data.AI_BASE_URL.startsWith('https://')) problems.push('AI_BASE_URL must be https in production');
    if (data.AI_API_KEY !== undefined && /change-me/i.test(data.AI_API_KEY)) problems.push('AI_API_KEY still has the example value');
  }
  if (problems.length > 0 || !result.success) throw new ConfigError(problems);
  const { NODE_ENV: _env, ...settings } = result.data;
  return settings;
}
