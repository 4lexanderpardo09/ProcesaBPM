import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './app-config.js';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://api:secret@localhost:5432/procesabpm',
  PLATFORM_DATABASE_URL: 'postgres://platform:secret@localhost:5432/procesabpm',
  JWT_SECRET: 'a-test-secret-of-at-least-32-bytes!!',
};

describe('loadConfig', () => {
  it('parses a complete environment and fills the documented defaults', () => {
    expect(loadConfig(valid)).toEqual({
      ...valid,
      PORT: 3000,
      DB_TX_TIMEOUT_MS: 10_000,
      DB_TX_MAX_WAIT_MS: 5_000,
      DB_POOL_MAX: 10,
      TRUST_PROXY: false,
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
    expect(loadConfig({ ...valid, TRUST_PROXY: value }).TRUST_PROXY).toEqual(expected);
  });

  it.each(['true', 'yes', '10.0.0.0/8,evil.example.com', '-1', ''])('rejects TRUST_PROXY=%j', (value) => {
    const error = catchError(() => loadConfig({ ...valid, TRUST_PROXY: value }));
    expect(error.problems).toEqual([expect.stringContaining('TRUST_PROXY')]);
  });

  it('reads the database tuning variables', () => {
    const config = loadConfig({ ...valid, DB_TX_TIMEOUT_MS: '20000', DB_TX_MAX_WAIT_MS: '1000', DB_POOL_MAX: '25' });
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
    const error = catchError(() => loadConfig({ ...valid, [variable]: value }));
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toContain(variable);
  });

  it.each(Object.keys(valid))('refuses to start without %s', (variable) => {
    const env: Record<string, string | undefined> = { ...valid, [variable]: undefined };
    expect(() => loadConfig(env)).toThrow(new ConfigError([`${variable} is required`]));
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
  ])('rejects %s=%s', (variable, value) => {
    const error = catchError(() => loadConfig({ ...valid, [variable]: value }));
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toContain(variable);
  });

  it('lists every problem at once', () => {
    const error = catchError(() => loadConfig({}));
    expect(error.problems).toHaveLength(Object.keys(valid).length);
  });

  it('counts the secret in bytes, not characters', () => {
    expect(loadConfig({ ...valid, JWT_SECRET: 'é'.repeat(16) }).JWT_SECRET).toHaveLength(16);
  });

  it('never prints the value of a rejected variable', () => {
    const error = catchError(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://user:topsecret@host/db' }));
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
