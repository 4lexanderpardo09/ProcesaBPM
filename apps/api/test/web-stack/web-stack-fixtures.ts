import type pg from 'pg';
import { seedMember, seedTenant, type SeededTenant, withPlatformTransaction } from '@procesabpm/db/testing/fixtures';
import { PasswordHasher } from '../../src/infrastructure/security/password-hasher.js';

/** Known to the web E2E suite (apps/web/e2e-stack/support/stack-fixtures.ts): keep both in sync. */
export const WEB_STACK_PASSWORD = 'e2e correct horse battery';

const ORGANIZATIONS = [
  { key: 'acme', name: 'Acme', mfaRequired: false },
  { key: 'globex', name: 'Globex', mfaRequired: false },
  { key: 'securia', name: 'Securia', mfaRequired: true },
] as const;

/** One person per scenario, so the per-identifier login limit (10 per 15 min) never trips across specs. */
const PEOPLE = [
  { email: 'ana@e2e.test', firstName: 'Ana', lastName: 'Torres', organizations: ['acme'] },
  { email: 'tabs@e2e.test', firstName: 'Tomás', lastName: 'Rey', organizations: ['acme'] },
  { email: 'leo@e2e.test', firstName: 'Leo', lastName: 'Mora', organizations: ['acme', 'globex'] },
  { email: 'eva@e2e.test', firstName: 'Eva', lastName: 'Ríos', organizations: ['securia'] },
  { email: 'bell@e2e.test', firstName: 'Bruno', lastName: 'Paz', organizations: ['acme'] },
  { email: 'flows@e2e.test', firstName: 'Fabio', lastName: 'Ruiz', organizations: ['acme'] },
] as const;

/** What the bell shows Bruno: two unread and one read, none about a ticket (the stack has no worker and no tickets). */
const BELL_NOTIFICATIONS = [
  { type: 'STORAGE_QUOTA', title: 'El almacenamiento llegó al 80 %', body: 'Usan 8 GB de 10 GB.', read: false, minutesAgo: 5 },
  { type: 'SYSTEM', title: 'Mantenimiento programado', body: 'El domingo a las 02:00 la aplicación no estará disponible.', read: false, minutesAgo: 90 },
  { type: 'SYSTEM', title: 'Bienvenida a ProcesaBPM', body: 'Ya puedes crear tickets.', read: true, minutesAgo: 60 * 24 * 10 },
] as const;

type OrganizationKey = (typeof ORGANIZATIONS)[number]['key'];

/** Organizations and people with fixed names, e-mails and one password, created the way the platform would. */
export async function seedWebStack(platform: pg.Pool): Promise<void> {
  const hash = await new PasswordHasher().hash(WEB_STACK_PASSWORD);
  const tenants = new Map<OrganizationKey, SeededTenant>();
  for (const organization of ORGANIZATIONS) {
    const tenant = await seedTenant(platform, `e2e-${organization.key}`);
    await platform.query('UPDATE tenants SET name = $2, slug = $3, mfa_required = $4 WHERE id = $1', [tenant.tenantId, organization.name, organization.key, organization.mfaRequired]);
    tenants.set(organization.key, tenant);
  }
  for (const person of PEOPLE) {
    const [first, ...others] = person.organizations.map((key) => tenants.get(key) ?? missing(key));
    if (first === undefined) continue;
    const userId = await seedMember(platform, first);
    await platform.query('UPDATE users SET email = $2, first_name = $3, last_name = $4, password_hash = $5 WHERE id = $1', [userId, person.email, person.firstName, person.lastName, hash]);
    for (const tenant of others) await addActiveMembership(platform, tenant, userId);
    if (person.email === 'bell@e2e.test') await seedNotifications(platform, first, userId);
  }
}

async function seedNotifications(platform: pg.Pool, tenant: SeededTenant, userId: string): Promise<void> {
  await withPlatformTransaction(platform, async (tx) => {
    for (const notification of BELL_NOTIFICATIONS) {
      const createdAt = new Date(Date.now() - notification.minutesAgo * 60_000);
      await tx.query('INSERT INTO notifications (tenant_id, user_id, type, title, body, read_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        tenant.tenantId,
        userId,
        notification.type,
        notification.title,
        notification.body,
        notification.read ? createdAt : null,
        createdAt,
      ]);
    }
  });
}

async function addActiveMembership(platform: pg.Pool, tenant: SeededTenant, userId: string): Promise<void> {
  await withPlatformTransaction(platform, async (tx) => {
    await tx.query(`INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`, [tenant.tenantId, userId, tenant.roleId]);
    await tx.query('INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)', [tenant.tenantId, userId, tenant.companyId]);
  });
}

function missing(key: string): never {
  throw new Error(`Unknown organization ${key}`);
}

