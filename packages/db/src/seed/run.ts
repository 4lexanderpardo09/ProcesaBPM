import pg from 'pg';
import { seedGlobalCatalog } from './seed-global-catalog.js';

/** CLI: `DATABASE_URL=<platform login> pnpm seed` — loads the global catalog. */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required (use a login role of app_platform)');
  }

  const currentYear = new Date().getUTCFullYear();
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await seedGlobalCatalog(client, { holidayYears: [currentYear - 1, currentYear, currentYear + 1, currentYear + 2] });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
