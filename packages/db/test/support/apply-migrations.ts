import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';

const MIGRATIONS_DIR = new URL('../../prisma/migrations/', import.meta.url).pathname;

/** Applies every Prisma migration folder in name order, exactly as `prisma migrate deploy` would. */
export async function applyMigrations(client: pg.Client): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const folder of folders) {
    const sql = await readFile(join(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf8');
    await client.query(sql);
  }
}
