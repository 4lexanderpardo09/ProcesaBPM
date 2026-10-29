import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedGlobalCatalog } from '../src/seed/seed-global-catalog.js';
import { applyMigrations } from './support/apply-migrations.js';
import { seedTenant } from './support/fixtures.js';

const run = promisify(execFile);
const SCRIPTS = new URL('../../../deploy/backup/', import.meta.url).pathname;
const BUCKET_URI = 's3://procesabpm-backups-test/postgres';

/** A stand-in for the AWS CLI: `aws s3 cp <file> s3://…` copies into a folder and logs the call; anything else fails. */
const FAKE_AWS = `#!/usr/bin/env bash
mkdir -p "$FAKE_S3"
echo "$*" >>"$FAKE_S3/calls.log"
[ "$1 $2" = "s3 cp" ] || { echo "unexpected aws call: $*" >&2; exit 64; }
[ -z "$FAKE_AWS_FAIL" ] || { echo "upload failed" >&2; exit 1; }
target="$FAKE_S3/objects/\${4#s3://}"
mkdir -p "$(dirname "$target")" && cp "$3" "$target"
`;

interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function script(name: string, args: readonly string[], env: Record<string, string>): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(join(SCRIPTS, name), args, { env: { ...process.env, ...env }, timeout: 120_000 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(folder.length + 1)).sort();
}

// The scripts drive a Postgres container with `docker exec`: without Docker (TEST_DATABASE_URL) there is nothing to run them on.
describe.skipIf(process.env.TEST_DATABASE_URL !== undefined)('database backup and restore scripts (deploy/backup)', () => {
  let container: StartedPostgreSqlContainer;
  let work: string;
  let env: Record<string, string>;
  let tenantSlug: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine').withDatabase('procesabpm').withUsername('procesabpm_owner').start();
    const owner = new pg.Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    try {
      await applyMigrations(owner);
      await seedGlobalCatalog(owner, { holidayYears: [2026] });
    } finally {
      await owner.end();
    }
    const pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    try {
      await seedTenant(pool, 'backup');
      tenantSlug = (await pool.query<{ slug: string }>('SELECT slug FROM tenants')).rows[0]!.slug;
    } finally {
      await pool.end();
    }

    work = await mkdtemp(join(tmpdir(), 'procesabpm-backup-'));
    await writeFile(join(work, 'aws'), FAKE_AWS);
    await chmod(join(work, 'aws'), 0o755);
    env = {
      PATH: `${work}:${process.env.PATH ?? ''}`,
      FAKE_S3: join(work, 's3'),
      FAKE_AWS_FAIL: '',
      BACKUP_S3_URI: BUCKET_URI,
      AWS_REGION: 'us-east-1',
      BACKUP_DB_CONTAINER: container.getId(),
      BACKUP_LOCAL_DIR: join(work, 'local'),
      BACKUP_MARKER: join(work, 'marker', 'last-success'),
      BACKUP_LOCAL_KEEP: '1',
    };
  }, 180_000);

  afterAll(async () => {
    await container?.stop();
    if (work !== undefined) await rm(work, { recursive: true, force: true });
  });

  it('uploads the dump, the roles and their checksums with server-side encryption, only ever writing, and leaves the marker', async () => {
    const outcome = await script('procesabpm-backup.sh', [], env);
    expect(outcome, outcome.stderr).toMatchObject({ code: 0 });

    const objects = await filesUnder(join(work, 's3', 'objects'));
    expect(objects).toHaveLength(4);
    expect(objects.every((key) => /^procesabpm-backups-test\/postgres\/\d{4}\/\d{2}\/procesabpm-\d{8}T\d{6}Z\.(dump|globals\.sql)(\.sha256)?$/.test(key))).toBe(true);
    const calls = (await readFile(join(work, 's3', 'calls.log'), 'utf8')).trim().split('\n');
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.startsWith('s3 cp ') && call.includes('--sse AES256'))).toBe(true);

    const globals = await readFile(join(work, 's3', 'objects', objects.find((key) => key.endsWith('.globals.sql'))!), 'utf8');
    expect(globals).toContain('CREATE ROLE app_runtime');
    const marker = await readFile(env.BACKUP_MARKER!, 'utf8');
    expect(marker).toMatch(new RegExp(`^object=${BUCKET_URI}/\\d{4}/\\d{2}/procesabpm-\\d{8}T\\d{6}Z\\.dump$`, 'm'));
    expect(marker).toMatch(/^entries=\d+$/m);
  });

  it('restores a backup into a scratch database next to the real one, with its data, policies and functions', async () => {
    const dump = (await filesUnder(env.BACKUP_LOCAL_DIR!)).find((name) => name.endsWith('.dump'))!;
    const outcome = await script('procesabpm-restore.sh', [join(env.BACKUP_LOCAL_DIR!, dump), '--database', 'procesabpm_restore_drill'], env);
    expect(outcome, outcome.stderr).toMatchObject({ code: 0 });
    expect(outcome.stdout).toMatch(/^tenants 1$/m);

    const shapeOf = async (database: string) => {
      const url = new URL(container.getConnectionUri());
      url.pathname = `/${database}`;
      const client = new pg.Client({ connectionString: url.toString() });
      await client.connect();
      try {
        const { rows } = await client.query<{ policies: string; functions: string; triggers: string; tenants: string }>(
          `SELECT (SELECT count(*) FROM pg_policies) AS policies,
                  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS functions,
                  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS triggers,
                  (SELECT string_agg(slug, ',') FROM tenants) AS tenants`,
        );
        return rows[0];
      } finally {
        await client.end();
      }
    };
    const source = await shapeOf('procesabpm');
    expect(await shapeOf('procesabpm_restore_drill')).toEqual(source);
    expect(source!.tenants).toBe(tenantSlug);
  });

  it('never restores into the real database without --into-production, and refuses a damaged file', async () => {
    const dump = join(env.BACKUP_LOCAL_DIR!, (await filesUnder(env.BACKUP_LOCAL_DIR!)).find((name) => name.endsWith('.dump'))!);
    expect((await script('procesabpm-restore.sh', [dump, '--database', 'procesabpm'], env)).code).toBe(2);

    const damaged = join(work, 'damaged.dump');
    await writeFile(damaged, 'not a dump');
    await writeFile(`${damaged}.sha256`, `${'0'.repeat(64)}  damaged.dump\n`);
    const refused = await script('procesabpm-restore.sh', [damaged, '--database', 'procesabpm_restore_drill'], env);
    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain('checksum');
  });

  it('fails without touching the marker when the upload fails, and keeps only the newest local copies', async () => {
    const before = await readFile(env.BACKUP_MARKER!, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const failed = await script('procesabpm-backup.sh', [], { ...env, FAKE_AWS_FAIL: '1' });
    expect(failed.code).not.toBe(0);
    expect(await readFile(env.BACKUP_MARKER!, 'utf8')).toBe(before);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect((await script('procesabpm-backup.sh', [], env)).code).toBe(0);
    expect(await readFile(env.BACKUP_MARKER!, 'utf8')).not.toBe(before);
    expect((await filesUnder(env.BACKUP_LOCAL_DIR!)).filter((name) => name.endsWith('.dump'))).toHaveLength(1);
  });

  it('refuses to start without a bucket, a region or a valid encryption setting', async () => {
    for (const [name, value] of [
      ['BACKUP_S3_URI', ''],
      ['BACKUP_S3_URI', 'https://bucket/prefix'],
      ['AWS_REGION', ''],
      ['BACKUP_SSE', 'none'],
    ] as const) {
      const outcome = await script('procesabpm-backup.sh', [], { ...env, [name]: value });
      expect(outcome.code, `${name}=${value}`).not.toBe(0);
    }
  });
}, 300_000);
