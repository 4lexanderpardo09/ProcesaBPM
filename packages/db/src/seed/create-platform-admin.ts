import { parseArgs } from 'node:util';
import pg from 'pg';
import { createPlatformAdmin, PLATFORM_ADMIN_LINK_VALIDITY_HOURS, PlatformAdminAlreadyExistsError, PlatformLoginRequiredError } from './platform-admin.js';

const USAGE = `Usage: DATABASE_URL=<platform login> WEB_BASE_URL=<https://app.example.com> create-platform-admin.js --email <address>
         [--first-name <name>] [--last-name <name>] [--force-additional]`;

/** CLI: creates the first platform admin and prints a one-time link to set the password. No public endpoint exists for this. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      'first-name': { type: 'string', default: 'Platform' },
      'last-name': { type: 'string', default: 'Admin' },
      'force-additional': { type: 'boolean', default: false },
    },
  });
  const connectionString = process.env.DATABASE_URL;
  const webBaseUrl = process.env.WEB_BASE_URL;
  if (!values.email || !connectionString || !webBaseUrl) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const admin = await createPlatformAdmin(client, {
      email: values.email,
      firstName: values['first-name'],
      lastName: values['last-name'],
      forceAdditional: values['force-additional'],
      webBaseUrl,
    });
    console.log(`Platform admin ready: ${admin.email}`);
    if (admin.setPasswordLink === null) {
      console.log('The user already has a password; MFA will be required at their next login.');
      return;
    }
    console.log(`Set the password within ${PLATFORM_ADMIN_LINK_VALIDITY_HOURS} h (expires ${admin.expiresAt!.toISOString()}); MFA enrollment is required at the first login:`);
    console.log(admin.setPasswordLink);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof PlatformAdminAlreadyExistsError || error instanceof PlatformLoginRequiredError) console.error(error.message);
  else console.error(error);
  process.exitCode = 1;
});
