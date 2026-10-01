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

const importsOf = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
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
});
