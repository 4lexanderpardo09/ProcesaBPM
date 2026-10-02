import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

const importsOf = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((match) => match[1]!);
const posix = (path: string) => relative(SRC, path).split(sep).join('/');

describe('architecture', () => {
  const files = sourceFiles(SRC);

  it('the platform database client (BYPASSRLS) is only reachable from the platform module and the database infrastructure', () => {
    const offenders = files
      .filter((file) => !posix(file).startsWith('modules/platform/') && !posix(file).startsWith('infrastructure/database/'))
      .filter((file) => importsOf(file).some((source) => /platform-(prisma\.service|transaction-runner|database\.module)/.test(source)))
      .map(posix);
    expect(offenders).toEqual([]);
  });

  it('only the platform module and the database infrastructure import the platform database module', () => {
    const importers = files.filter((file) => importsOf(file).some((source) => source.includes('platform-database.module'))).map(posix);
    expect(importers.sort()).toEqual(['modules/platform/platform.module.ts']);
  });

  it('the worker-only modules (outbox dispatcher, mail, account mail, notifications and documents fan-out) are only imported by the worker', () => {
    const workerOnly = /(outbox-dispatcher\.module|mail\.module|auth-mail\.module|notifications-worker\.module|documents-worker\.module)/;
    const importers = files.filter((file) => importsOf(file).some((source) => workerOnly.test(source))).map(posix);
    expect(importers.sort()).toEqual(['modules/auth/auth-mail.module.ts', 'modules/documents/documents-worker.module.ts', 'modules/notifications/notifications-worker.module.ts', 'worker.module.ts']);
  });

  it('the worker never imports the controllers or the guards of the API', () => {
    const offenders = files.filter((file) => posix(file).startsWith('modules/') && /notifications-worker|documents-worker|auth-mail|file-purge/.test(posix(file))).filter((file) => importsOf(file).some((source) => /\.controller\.js$|authorization\.module\.js$|\.guard\.js$/.test(source))).map(posix);
    expect(offenders).toEqual([]);
  });
});
