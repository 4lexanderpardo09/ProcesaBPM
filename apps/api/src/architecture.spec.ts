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

  it('the worker-only modules (outbox dispatcher, mail, account mail, notifications, documents fan-out, data exports, tenant purge, retention and the wait wake-up) are only imported by the worker', () => {
    const workerOnly = /(outbox-dispatcher\.module|mail\.module|auth-mail\.module|auth-maintenance\.module|notifications-worker\.module|documents-worker\.module|data-exports-worker\.module|tenant-purge\.module|retention\.module)/;
    const importers = files.filter((file) => importsOf(file).some((source) => workerOnly.test(source))).map(posix);
    expect(importers.sort()).toEqual(['modules/auth/auth-mail.module.ts', 'modules/data-exports/data-exports-worker.module.ts', 'modules/documents/documents-worker.module.ts', 'modules/engine/wait.module.ts', 'modules/notifications/notifications-worker.module.ts', 'modules/realtime/realtime-worker.module.ts', 'worker.module.ts']);
  });

  it('no SQL is built from text: the unsafe raw-query helpers are never used', () => {
    const offenders = files.filter((file) => /\$(queryRaw|executeRaw)Unsafe|\bPrisma\.raw\b|\{[^}]*\braw\b[^}]*\}\s*=\s*Prisma\b/.test(readFileSync(file, 'utf8'))).map(posix);
    expect(offenders).toEqual([]);
  });

  it('the worker never imports the controllers or the guards of the API', () => {
    const offenders = files.filter((file) => posix(file).startsWith('modules/') && /notifications-worker|documents-worker|data-exports-worker|data-exports\/application\/data-export|auth-mail|auth-maintenance|file-purge|retention/.test(posix(file))).filter((file) => importsOf(file).some((source) => /\.controller\.js$|authorization\.module\.js$|\.guard\.js$/.test(source))).map(posix);
    expect(offenders).toEqual([]);
  });

  it('real time: the API and the worker each import only their own side', () => {
    const importersOf = (pattern: RegExp) => files.filter((file) => importsOf(file).some((source) => pattern.test(source))).map(posix).sort();
    expect(importersOf(/realtime-worker\.module/)).toEqual(['worker.module.ts']);
    expect(importersOf(/realtime-signal-publisher\.module/)).toEqual(['modules/documents/documents-worker.module.ts', 'modules/notifications/notifications-worker.module.ts', 'modules/realtime/realtime-worker.module.ts']);
    expect(importersOf(/\/realtime\.module/)).toEqual(['app.module.ts']);
    expect(importersOf(/realtime-listener\.module/)).toEqual(['modules/realtime/realtime.module.ts']);
  });

  it('no WebSocket message handler is declared with @SubscribeMessage (the global HTTP guard would refuse it): ClientMessageRouter wires them', () => {
    const offenders = files.filter((file) => /^\s*@SubscribeMessage\b|import\s*\{[^}]*\bSubscribeMessage\b[^}]*\}\s*from\s*'@nestjs\/websockets'/m.test(readFileSync(file, 'utf8'))).map(posix);
    expect(offenders).toEqual([]);
  });

  it('in the realtime module only RealtimeEmitter sends to or closes a socket, and nothing broadcasts to a room', () => {
    const offenders = files
      .filter((file) => posix(file).startsWith('modules/realtime/') && posix(file) !== 'modules/realtime/application/realtime-emitter.ts')
      .filter((file) => /\.to\(|\.in\(|\.broadcast\b|\bserver\.emit\(|(?<!emitter)\.emit\(|\.disconnect\(|\.disconnectSockets\(/.test(readFileSync(file, 'utf8')))
      .map(posix);
    expect(offenders).toEqual([]);
  });

  it('only the four transaction runners brand a transaction', () => {
    const importers = files.filter((file) => /\basScoped\b/.test(readFileSync(file, 'utf8'))).map(posix);
    expect(importers.sort()).toEqual([
      'infrastructure/database/auth-transaction-runner.ts',
      'infrastructure/database/platform-transaction-runner.ts',
      'infrastructure/database/tenant-transaction-runner.ts',
      'infrastructure/database/transaction-scope.ts',
      'infrastructure/database/worker-transaction-runner.ts',
    ]);
  });
});
