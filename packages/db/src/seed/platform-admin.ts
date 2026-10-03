import { createHash, randomBytes } from 'node:crypto';
import type { ClientBase } from 'pg';

export const PLATFORM_ADMIN_LINK_VALIDITY_HOURS = 24;
export const PLATFORM_ADMIN_BOOTSTRAP_ACTION = 'platform_admin.bootstrapped';

export class PlatformAdminAlreadyExistsError extends Error {
  constructor() {
    super('A platform admin already exists; pass --force-additional to add another one from the command line');
    this.name = 'PlatformAdminAlreadyExistsError';
  }
}

export interface CreatePlatformAdminInput {
  email: string;
  firstName: string;
  lastName: string;
  forceAdditional: boolean;
  webBaseUrl: string;
}

export interface CreatedPlatformAdmin {
  userId: string;
  email: string;
  setPasswordLink: string;
  expiresAt: Date;
}

/**
 * Creates (or reuses) the global user, makes it a platform admin and issues a one-time link to set the password.
 * MFA is not optional for platform admins: the API forces the enrollment at the first login.
 * Runs in one transaction; the caller supplies a connection of an `app_platform` login.
 */
export async function createPlatformAdmin(client: ClientBase, input: CreatePlatformAdminInput): Promise<CreatedPlatformAdmin> {
  const email = input.email.trim().toLowerCase();
  await client.query('BEGIN');
  try {
    const result = await provision(client, { ...input, email });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function provision(client: ClientBase, input: CreatePlatformAdminInput): Promise<CreatedPlatformAdmin> {
  await client.query('LOCK TABLE platform_admins IN SHARE ROW EXCLUSIVE MODE');
  const userId = await upsertUser(client, input);
  await assertAllowed(client, userId, input.forceAdditional);
  await client.query('INSERT INTO platform_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const issued = await client.query<{ id: string }>(
    `SELECT auth_issue_user_token($1::uuid, 'PASSWORD_RESET', $2, now() + make_interval(hours => $3::int)) AS id`,
    [userId, tokenHash, PLATFORM_ADMIN_LINK_VALIDITY_HOURS],
  );
  const { rows } = await client.query<{ expires_at: Date }>('SELECT expires_at FROM user_tokens WHERE id = $1', [issued.rows[0]!.id]);
  await client.query(
    `INSERT INTO platform_audit_logs (actor_user_id, action, data) VALUES ($1, $2, $3::jsonb)`,
    [userId, PLATFORM_ADMIN_BOOTSTRAP_ACTION, JSON.stringify({ email: input.email, forceAdditional: input.forceAdditional, via: 'cli' })],
  );

  return { userId, email: input.email, setPasswordLink: buildLink(input.webBaseUrl, token), expiresAt: rows[0]!.expires_at };
}

async function upsertUser(client: ClientBase, input: CreatePlatformAdminInput): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (email, first_name, last_name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [input.email, input.firstName, input.lastName],
  );
  return rows[0]!.id;
}

/** Re-running for the only admin who has not chosen a password yet is allowed: it just issues a fresh link. */
async function assertAllowed(client: ClientBase, userId: string, forceAdditional: boolean): Promise<void> {
  if (forceAdditional) return;
  const { rows } = await client.query<{ others: boolean; pending: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id <> $1) AS others,
            EXISTS (SELECT 1 FROM users WHERE id = $1 AND password_hash IS NULL) AS pending`,
    [userId],
  );
  const { others, pending } = rows[0]!;
  const alreadyAdmin = (await client.query('SELECT 1 FROM platform_admins WHERE user_id = $1', [userId])).rowCount === 1;
  if (others || (alreadyAdmin && !pending)) throw new PlatformAdminAlreadyExistsError();
}

function buildLink(webBaseUrl: string, token: string): string {
  const base = webBaseUrl.endsWith('/') ? webBaseUrl : `${webBaseUrl}/`;
  const url = new URL('reset-password', base);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}
