import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export interface SeededTenant {
  tenantId: string;
  userId: string;
  roleId: string;
  companyId: string;
}

export interface SeededWorkflow {
  subcategoryId: string;
  workflowId: string;
  versionId: string;
  startStepId: string;
  taskStepId: string;
}

export interface SeededTicket extends SeededWorkflow {
  ticketId: string;
}

/** Anything that can run a query: a pool or a client inside a transaction. */
type Queryable = Pick<pg.Pool, 'query'>;

const COUNTRY = { code: 'CO', currency: 'COP', timeZone: 'America/Bogota' } as const;

export async function insertReturningId(db: Queryable, sql: string, params: unknown[] = []): Promise<string> {
  const result = await db.query<{ id: string }>(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error(`Insert returned no id: ${sql}`);
  return row.id;
}

function shortId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * Provisions a tenant the way the platform service will: tenant, default company,
 * an admin role and one active member attached to the company. Uses the platform role.
 */
export async function seedTenant(platform: pg.Pool, label = shortId()): Promise<SeededTenant> {
  const tenantId = await insertReturningId(
    platform,
    `INSERT INTO tenants (slug, name, plan_id, country_code, time_zone)
     SELECT $1, $2, id, $3, $4 FROM plans WHERE code = 'professional' RETURNING id`,
    [`tenant-${label}`, `Tenant ${label}`, COUNTRY.code, COUNTRY.timeZone],
  );
  const companyId = await insertReturningId(
    platform,
    `INSERT INTO companies (tenant_id, name, is_default, country_code, currency_code, time_zone)
     VALUES ($1, 'Default company', true, $2, $3, $4) RETURNING id`,
    [tenantId, COUNTRY.code, COUNTRY.currency, COUNTRY.timeZone],
  );
  const roleId = await insertReturningId(
    platform,
    `INSERT INTO roles (tenant_id, name, system_role, is_admin) VALUES ($1, 'Admin', 'ADMIN', true) RETURNING id`,
    [tenantId],
  );
  const userId = await seedMember(platform, { tenantId, roleId, companyId }, `admin-${label}`);

  return { tenantId, userId, roleId, companyId };
}

/** Adds an active member (global user + membership + company) to a tenant. */
export async function seedMember(
  platform: pg.Pool,
  tenant: Pick<SeededTenant, 'tenantId' | 'roleId' | 'companyId'>,
  label = shortId(),
): Promise<string> {
  const userId = await insertReturningId(
    platform,
    `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'Test', $2) RETURNING id`,
    [`${label}@example.com`, label],
  );
  await withPlatformTransaction(platform, async (tx) => {
    await tx.query(
      `INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`,
      [tenant.tenantId, userId, tenant.roleId],
    );
    await tx.query(`INSERT INTO membership_companies (tenant_id, user_id, company_id) VALUES ($1, $2, $3)`, [
      tenant.tenantId,
      userId,
      tenant.companyId,
    ]);
  });
  return userId;
}

/**
 * A workflow with a DRAFT version: START -> TASK (handled by the creator).
 * Configuration can only be written while the version is a draft.
 */
export async function seedDraftWorkflow(platform: pg.Pool, tenant: SeededTenant): Promise<SeededWorkflow> {
  const { tenantId } = tenant;
  const categoryId = await insertReturningId(
    platform,
    `INSERT INTO categories (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `Category ${shortId()}`],
  );
  const subcategoryId = await insertReturningId(
    platform,
    `INSERT INTO subcategories (tenant_id, category_id, name) VALUES ($1, $2, 'Request') RETURNING id`,
    [tenantId, categoryId],
  );
  const workflowId = await insertReturningId(
    platform,
    `INSERT INTO workflows (tenant_id, subcategory_id, name) VALUES ($1, $2, 'Flow') RETURNING id`,
    [tenantId, subcategoryId],
  );
  const versionId = await insertReturningId(
    platform,
    `INSERT INTO workflow_versions (tenant_id, workflow_id, number) VALUES ($1, $2, 1) RETURNING id`,
    [tenantId, workflowId],
  );
  const startStepId = await insertStep(platform, tenantId, versionId, { type: 'START', name: 'Start' });
  const taskStepId = await insertStep(platform, tenantId, versionId, {
    type: 'TASK',
    name: 'Review',
    assignmentMode: 'CREATOR',
  });
  await platform.query(
    `INSERT INTO transitions (tenant_id, version_id, from_step_id, to_step_id, type, label)
     VALUES ($1, $2, $3, $4, 'DEFAULT', 'Continue')`,
    [tenantId, versionId, startStepId, taskStepId],
  );

  return { subcategoryId, workflowId, versionId, startStepId, taskStepId };
}

export async function insertStep(
  db: Queryable,
  tenantId: string,
  versionId: string,
  step: { type: string; name: string; assignmentMode?: string },
): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO steps (tenant_id, version_id, type, name, assignment_mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, versionId, step.type, step.name, step.assignmentMode ?? 'NONE'],
  );
}

export async function publishVersion(db: Queryable, tenantId: string, versionId: string): Promise<void> {
  await db.query(`UPDATE workflow_versions SET status = 'PUBLISHED' WHERE tenant_id = $1 AND id = $2`, [
    tenantId,
    versionId,
  ]);
}

/** A published workflow and an OPEN ticket sitting on its TASK step. Uses the platform role. */
export async function seedTicket(platform: pg.Pool, tenant: SeededTenant): Promise<SeededTicket> {
  const workflow = await seedDraftWorkflow(platform, tenant);
  await publishVersion(platform, tenant.tenantId, workflow.versionId);
  const ticketId = await insertTicket(platform, tenant, workflow);
  return { ...workflow, ticketId };
}

export async function insertTicket(db: Queryable, tenant: SeededTenant, workflow: SeededWorkflow): Promise<string> {
  return insertReturningId(
    db,
    `INSERT INTO tickets (tenant_id, number, workflow_id, workflow_version_id, subcategory_id, company_id, creator_id,
                          title, description_html, current_step_id)
     VALUES ($1, (SELECT coalesce(max(number), 0) + 1 FROM tickets WHERE tenant_id = $1),
             $2, $3, $4, $5, $6, 'Test ticket', '<p>Hello</p>', $7) RETURNING id`,
    [
      tenant.tenantId,
      workflow.workflowId,
      workflow.versionId,
      workflow.subcategoryId,
      tenant.companyId,
      tenant.userId,
      workflow.taskStepId,
    ],
  );
}

/** Runs several statements in one transaction on a pooled connection. */
export async function withPlatformTransaction<T>(pool: pg.Pool, work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
