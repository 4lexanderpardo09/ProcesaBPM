import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './app-config.js';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgresql://api:secret@localhost:5432/procesabpm',
  PLATFORM_DATABASE_URL: 'postgres://platform:secret@localhost:5432/procesabpm',
};

describe('loadConfig', () => {
  it('parses a complete environment', () => {
    expect(loadConfig(valid)).toEqual({ ...valid, PORT: 3000 });
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
