import { describe, expect, it } from 'vitest';
import { ConfigError, loadApiConfig, loadWorkerConfig } from './app-config.js';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://api:secret@localhost:5432/procesabpm',
  PLATFORM_DATABASE_URL: 'postgres://platform:secret@localhost:5432/procesabpm',
  JWT_SECRET: 'a-test-secret-of-at-least-32-bytes!!',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'procesabpm',
  STORAGE_ACCESS_KEY_ID: 'testkey',
  STORAGE_SECRET_ACCESS_KEY: 'testkey',
};
const workerUrl = 'postgresql://worker:secret@localhost:5432/procesabpm';

describe('loadApiConfig / loadWorkerConfig', () => {
  it('parses a complete environment and fills the documented defaults', () => {
    expect(loadApiConfig(valid)).toEqual({
      ...valid,
      PORT: 3000,
      DB_TX_TIMEOUT_MS: 10_000,
      DB_TX_MAX_WAIT_MS: 5_000,
      DB_LOCK_TIMEOUT_MS: 5_000,
      DB_POOL_MAX: 10,
      TRUST_PROXY: false,
      STORAGE_REGION: 'us-east-1',
      STORAGE_FORCE_PATH_STYLE: false,
    });
  });

  it.each([
    ['false', false],
    ['1', 1],
    ['2', 2],
    ['loopback', ['loopback']],
    ['10.0.0.0/8, 192.168.1.10', ['10.0.0.0/8', '192.168.1.10']],
    ['fd00::/8', ['fd00::/8']],
  ])('reads TRUST_PROXY=%s', (value, expected) => {
    expect(loadApiConfig({ ...valid, TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
  });

  it.each(['true', 'yes', '10.0.0.0/8,evil.example.com', '-1', ''])('rejects TRUST_PROXY=%j', (value) => {
    const error = catchError(() => loadApiConfig({ ...valid, TRUST_PROXY: value }));
    expect(error.problems).toEqual([expect.stringContaining('TRUST_PROXY')]);
  });

  describe('entry points', () => {
    it('the API needs DATABASE_URL and ignores WORKER_DATABASE_URL', () => {
      const { DATABASE_URL: _removed, ...withoutUrl } = valid;
      expect(catchError(() => loadApiConfig(withoutUrl)).problems).toEqual(['DATABASE_URL is required']);
      const config = loadApiConfig({ ...valid, WORKER_DATABASE_URL: workerUrl });
      expect(config.DATABASE_URL).toBe(valid.DATABASE_URL);
      expect(config).not.toHaveProperty('WORKER_DATABASE_URL');
    });

    it('the worker connects with WORKER_DATABASE_URL, never with the API login', () => {
      const config = loadWorkerConfig({ ...valid, WORKER_DATABASE_URL: workerUrl });
      expect(config.DATABASE_URL).toBe(workerUrl);
      expect(config).not.toHaveProperty('WORKER_DATABASE_URL');
    });

    it('the worker refuses to start without WORKER_DATABASE_URL, even if DATABASE_URL is set', () => {
      expect(catchError(() => loadWorkerConfig(valid)).problems).toEqual(['WORKER_DATABASE_URL is required']);
    });

    it('the worker needs no PORT, JWT_SECRET, DATABASE_URL or platform login, and never carries them', () => {
      const workerEnvironment = { ...valid, WORKER_DATABASE_URL: workerUrl };
      const config = loadWorkerConfig(workerEnvironment);
      for (const name of ['PORT', 'JWT_SECRET', 'TRUST_PROXY', 'PLATFORM_DATABASE_URL']) expect(config).not.toHaveProperty(name);

      const { PORT: _p, JWT_SECRET: _j, DATABASE_URL: _d, PLATFORM_DATABASE_URL: _l, ...bare } = workerEnvironment;
      expect(loadWorkerConfig(bare).DATABASE_URL).toBe(workerUrl);
    });

    it('the API requires the platform login', () => {
      const { PLATFORM_DATABASE_URL: _removed, ...withoutPlatform } = valid;
      expect(catchError(() => loadApiConfig(withoutPlatform)).problems).toEqual(['PLATFORM_DATABASE_URL is required']);
    });

    it('rejects a worker URL that is not PostgreSQL', () => {
      const error = catchError(() => loadWorkerConfig({ ...valid, WORKER_DATABASE_URL: 'mysql://x/y' }));
      expect(error.problems).toEqual([expect.stringContaining('WORKER_DATABASE_URL')]);
    });
  });

  it('reads the storage settings, with the public endpoint and path style when given', () => {
    const config = loadApiConfig({ ...valid, STORAGE_PUBLIC_ENDPOINT: 'https://files.example.com', STORAGE_FORCE_PATH_STYLE: 'true', STORAGE_REGION: 'auto' });
    expect(config).toMatchObject({ STORAGE_PUBLIC_ENDPOINT: 'https://files.example.com', STORAGE_FORCE_PATH_STYLE: true, STORAGE_REGION: 'auto' });
  });

  it('reads the database tuning variables', () => {
    const config = loadApiConfig({ ...valid, DB_TX_TIMEOUT_MS: '20000', DB_TX_MAX_WAIT_MS: '1000', DB_POOL_MAX: '25' });
    expect(config).toMatchObject({ DB_TX_TIMEOUT_MS: 20_000, DB_TX_MAX_WAIT_MS: 1_000, DB_POOL_MAX: 25 });
  });

  it.each([
    ['DB_TX_TIMEOUT_MS', '0'],
    ['DB_TX_TIMEOUT_MS', 'fast'],
    ['DB_TX_TIMEOUT_MS', '999999999'],
    ['DB_TX_MAX_WAIT_MS', '-5'],
    ['DB_POOL_MAX', '0'],
    ['DB_POOL_MAX', '1.5'],
    ['DB_POOL_MAX', '5000'],
  ])('rejects %s=%s', (variable, value) => {
    const error = catchError(() => loadApiConfig({ ...valid, [variable]: value }));
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toContain(variable);
  });

  it.each(Object.keys(valid))('refuses to start without %s', (variable) => {
    const env: Record<string, string | undefined> = { ...valid, [variable]: undefined };
    expect(() => loadApiConfig(env)).toThrow(new ConfigError([`${variable} is required`]));
  });

  it.each([
    ['NODE_ENV', 'staging'],
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['LOG_LEVEL', 'verbose'],
    ['DATABASE_URL', 'mysql://localhost/db'],
    ['PLATFORM_DATABASE_URL', 'not a url'],
    ['JWT_SECRET', 'too-short'],
    ['JWT_SECRET', 'é'.repeat(15)],
    ['STORAGE_ENDPOINT', 'ftp://storage'],
    ['STORAGE_PUBLIC_ENDPOINT', 'storage.example.com'],
    ['STORAGE_FORCE_PATH_STYLE', 'yes'],
  ])('rejects %s=%s', (variable, value) => {
    const error = catchError(() => loadApiConfig({ ...valid, [variable]: value }));
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toContain(variable);
  });

  it('lists every problem at once', () => {
    const error = catchError(() => loadApiConfig({}));
    expect(error.problems).toHaveLength(Object.keys(valid).length);
  });

  it('counts the secret in bytes, not characters', () => {
    expect(loadApiConfig({ ...valid, JWT_SECRET: 'é'.repeat(16) }).JWT_SECRET).toHaveLength(16);
  });

  it('never prints the value of a rejected variable', () => {
    const error = catchError(() => loadApiConfig({ ...valid, DATABASE_URL: 'mysql://user:topsecret@host/db' }));
    expect(error.message).not.toContain('topsecret');
  });
});

function catchError(action: () => unknown): ConfigError {
  try {
    action();
  } catch (error) {
    return error as ConfigError;
  }
  throw new Error('Expected the action to throw');
}
