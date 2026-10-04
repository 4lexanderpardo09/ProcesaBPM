import { describe, expect, it } from 'vitest';
import { ConfigError } from './app-config.js';
import { loadWorkerSettings } from './worker-settings.js';

const valid = { NODE_ENV: 'development', WEB_BASE_URL: 'http://localhost:5173', OUTBOX_TOKEN_KEY: 'k'.repeat(32), SMTP_HOST: 'localhost' };
const problemsOf = (env: Record<string, string | undefined>): string[] => {
  try {
    loadWorkerSettings(env);
  } catch (error) {
    return (error as ConfigError).problems as string[];
  }
  return [];
};

describe('loadWorkerSettings', () => {
  it('fills the documented defaults', () => {
    expect(loadWorkerSettings(valid)).toMatchObject({ MAIL_TRANSPORT: 'smtp', SMTP_PORT: 1025, SMTP_SECURE: false, OUTBOX_POLLING_ENABLED: true, OUTBOX_POLL_INTERVAL_MS: 2000, OUTBOX_BATCH_SIZE: 10, OUTBOX_CONCURRENCY: 4, OUTBOX_TX_TIMEOUT_MS: 30_000 });
  });
  it('bounds the data export by 4 hours and 100 GiB unless configured, never beyond what a multipart upload holds', () => {
    expect(loadWorkerSettings(valid)).toMatchObject({ DATA_EXPORT_MAX_RUN_MS: 4 * 3_600_000, DATA_EXPORT_MAX_BYTES: 100 * 1024 ** 3 });
    expect(loadWorkerSettings({ ...valid, DATA_EXPORT_MAX_BYTES: '1048576' }).DATA_EXPORT_MAX_BYTES).toBe(1_048_576);
    expect(problemsOf({ ...valid, DATA_EXPORT_MAX_BYTES: String(200 * 1024 ** 3) })).toEqual([expect.stringContaining('DATA_EXPORT_MAX_BYTES')]);
    expect(problemsOf({ ...valid, DATA_EXPORT_MAX_RUN_MS: '0' })).toEqual([expect.stringContaining('DATA_EXPORT_MAX_RUN_MS')]);
  });
  it('requires the base URL and the token key', () => {
    expect(problemsOf({ ...valid, WEB_BASE_URL: undefined })).toEqual(['WEB_BASE_URL is required']);
    expect(problemsOf({ ...valid, OUTBOX_TOKEN_KEY: 'short' })).toEqual([expect.stringContaining('OUTBOX_TOKEN_KEY')]);
  });
  it('needs an SMTP host unless the transport is memory', () => {
    expect(problemsOf({ ...valid, SMTP_HOST: undefined })).toEqual(['SMTP_HOST is required when MAIL_TRANSPORT is smtp']);
    expect(problemsOf({ ...valid, SMTP_HOST: undefined, MAIL_TRANSPORT: 'memory' })).toEqual([]);
  });
  it('refuses the memory transport and a plain http base URL in production', () => {
    const production = { ...valid, NODE_ENV: 'production' };
    const secure = { ...production, WEB_BASE_URL: 'https://app.example.com' };
    expect(problemsOf({ ...secure, MAIL_TRANSPORT: 'memory' })).toEqual(['MAIL_TRANSPORT memory is not allowed in production']);
    expect(problemsOf(production)).toEqual(['WEB_BASE_URL must be https in production']);
    expect(problemsOf(secure)).toEqual([]);
  });
  it('counts the time to draw a PDF in the lease budget', () => {
    expect(problemsOf({ ...valid, OUTBOX_BATCH_SIZE: '12', OUTBOX_CONCURRENCY: '1', OUTBOX_TX_TIMEOUT_MS: '10000', PDF_RENDER_TIMEOUT_MS: '30000', REALTIME_SIGNALS_ENABLED: 'false' })).toEqual([expect.stringContaining('PDF_RENDER_TIMEOUT_MS')]);
    expect(problemsOf({ ...valid, PDF_RENDER_TIMEOUT_MS: '500000' })).not.toEqual([]);
  });

  it('refuses a batch that could outlive the claim lease', () => {
    expect(problemsOf({ ...valid, OUTBOX_BATCH_SIZE: '500', OUTBOX_CONCURRENCY: '1' })).toEqual([expect.stringContaining('outlive the claim lease')]);
    expect(problemsOf({ ...valid, OUTBOX_BATCH_SIZE: '100', OUTBOX_CONCURRENCY: '64' })).toEqual([]);
  });
  it('counts the realtime signals published after each commit in the lease budget', () => {
    const fiveWaves = { ...valid, OUTBOX_BATCH_SIZE: '5', OUTBOX_CONCURRENCY: '1', OUTBOX_TX_TIMEOUT_MS: '30000', PDF_RENDER_TIMEOUT_MS: '10000' };
    expect(problemsOf(fiveWaves)).toEqual([expect.stringContaining('realtime signals after commit')]);
    expect(problemsOf({ ...fiveWaves, REALTIME_SIGNALS_ENABLED: 'false' })).toEqual([]);
    expect(problemsOf({ ...fiveWaves, OUTBOX_TX_TIMEOUT_MS: '20000' })).toEqual([]);
  });
  it('wants the SMTP credentials together', () => {
    expect(problemsOf({ ...valid, SMTP_USER: 'u' })).toEqual(['SMTP_USER and SMTP_PASSWORD go together']);
  });
});
