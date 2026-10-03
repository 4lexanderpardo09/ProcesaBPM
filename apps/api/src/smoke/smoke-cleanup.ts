import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import type { SmokeConfig } from './smoke-config.js';
import { SMOKE_SLUG, SMOKE_TENANT_NAME, type SmokeState } from './smoke-run.js';

const STORAGE_BATCH = 1000;
const STALE_AFTER_MS = 60 * 60_000;

/**
 * Removes what the smoke run created: its organization (data, through `purge_tenant`), the files it put in the bucket and its
 * administrator. Only things that look like smoke test leftovers are touched: the slug has the smoke form AND the name is the
 * smoke name, so a real organization can never match. Leftovers of an earlier run that died halfway are removed too.
 */
export async function cleanUp(config: SmokeConfig, state: SmokeState): Promise<{ tenants: number; objects: number }> {
  const storage = new S3Client({
    endpoint: config.STORAGE_ENDPOINT,
    region: config.STORAGE_REGION,
    forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: config.STORAGE_ACCESS_KEY_ID, secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY },
  });
  const client = new pg.Client({ connectionString: config.SMOKE_DATABASE_URL });
  await client.connect();
  try {
    const tenantIds = await smokeTenantIds(client, state);
    let objects = 0;
    for (const tenantId of tenantIds) {
      objects += await emptyPrefix(storage, config.STORAGE_BUCKET, `tenants/${tenantId}/`);
      await client.query('SELECT purge_tenant($1::uuid)', [tenantId]);
    }
    await removeAdmins(client, state);
    return { tenants: tenantIds.length, objects };
  } finally {
    await client.end();
  }
}

async function smokeTenantIds(client: pg.Client, state: SmokeState): Promise<string[]> {
  const { rows } = await client.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM tenants WHERE name = $1 AND status IN ('ACTIVE', 'SUSPENDED') AND (id = $2::uuid OR created_at < now() - make_interval(secs => $3))`,
    [SMOKE_TENANT_NAME, state.tenantId ?? null, STALE_AFTER_MS / 1000],
  );
  return rows.filter((row) => SMOKE_SLUG.test(row.slug)).map((row) => row.id);
}

async function emptyPrefix(storage: S3Client, bucket: string, prefix: string): Promise<number> {
  let removed = 0;
  for (;;) {
    const listed = await storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: STORAGE_BATCH }));
    const keys = (listed.Contents ?? []).flatMap((entry) => (entry.Key === undefined ? [] : [entry.Key]));
    if (keys.length === 0) return removed;
    const result = await storage.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
    if ((result.Errors ?? []).length > 0) throw new Error(`Could not delete ${result.Errors!.length} smoke objects under ${prefix}`);
    removed += keys.length;
  }
}

async function removeAdmins(client: pg.Client, state: SmokeState): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE email ~ '^smoke-(admin|owner)-[0-9a-f]{8}@smoke\\.invalid$' AND (id = $1::uuid OR created_at < now() - make_interval(secs => $2))`,
    [state.adminUserId ?? null, STALE_AFTER_MS / 1000],
  );
  for (const { id } of rows) {
    await client.query('DELETE FROM platform_admins WHERE user_id = $1', [id]);
    await client.query('DELETE FROM users WHERE id = $1', [id]);
  }
}
