import { PDF_LIMITS } from '@procesabpm/shared';
import { z } from 'zod';
import { ConfigError } from './app-config.js';

const httpUrl = z.string().refine((value) => /^https?:\/\//.test(value), 'must be an http(s) URL');
const boolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');
const positiveInteger = (defaultValue: number, max: number) => z.coerce.number().int().min(1).max(max).default(defaultValue);

/** Worst case allowed for one batch: half of the 5-minute lease. */
const MAX_BATCH_PROCESSING_MS = 150_000;
/** With rendering included: the lease is 5 minutes and the last wave still has to record its result. */
const MAX_BATCH_WITH_RENDERING_MS = 270_000;

const settingsSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  /** Where the web app lives: the links in e-mails are built on it. */
  WEB_BASE_URL: httpUrl,
  /** HMAC key the worker derives the one-time tokens of e-mail links from. Only the worker has it. */
  OUTBOX_TOKEN_KEY: z.string().refine((value) => Buffer.byteLength(value, 'utf8') >= 32, 'must be at least 32 bytes long'),
  MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
  MAIL_FROM: z.string().min(3).default('ProcesaBPM <no-reply@procesabpm.local>'),
  MAIL_MESSAGE_ID_DOMAIN: z.string().min(3).default('procesabpm.local'),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: positiveInteger(1025, 65_535),
  SMTP_SECURE: boolean(false),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
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
    if (waves * data.OUTBOX_TX_TIMEOUT_MS > MAX_BATCH_PROCESSING_MS) problems.push('OUTBOX_BATCH_SIZE / OUTBOX_CONCURRENCY waves of OUTBOX_TX_TIMEOUT_MS would outlive the claim lease');
    else if (waves * (data.OUTBOX_TX_TIMEOUT_MS + data.PDF_RENDER_TIMEOUT_MS) > MAX_BATCH_WITH_RENDERING_MS) problems.push('OUTBOX_BATCH_SIZE / OUTBOX_CONCURRENCY waves of OUTBOX_TX_TIMEOUT_MS plus PDF_RENDER_TIMEOUT_MS would outlive the claim lease');
    if ((data.SMTP_USER === undefined) !== (data.SMTP_PASSWORD === undefined)) problems.push('SMTP_USER and SMTP_PASSWORD go together');
  }
  if (problems.length > 0 || !result.success) throw new ConfigError(problems);
  const { NODE_ENV: _env, ...settings } = result.data;
  return settings;
}
