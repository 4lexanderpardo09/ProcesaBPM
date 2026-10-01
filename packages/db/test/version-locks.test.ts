import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, type TestDatabase } from './support/database.js';
import { seedDraftWorkflow, seedTenant, type SeededTenant } from './support/fixtures.js';

describe('version-scoped amount rules, draft locks and revision', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
  });

  afterAll(async () => {
    await db.close();
  });

  const insertRule = (versionId: string, stepId: string | null, approvalStepId: string | null) =>
    db.platform.query(
      `INSERT INTO amount_rules (tenant_id, version_id, step_id, field_code, max_amount, currency_code, action, approval_step_id)
       VALUES ($1, $2, $3, 'AMOUNT', 100, 'COP', CASE WHEN $4::uuid IS NULL THEN 'BLOCK' ELSE 'EXTRA_APPROVAL' END::amount_rule_action, $4)`,
      [tenant.tenantId, versionId, stepId, approvalStepId],
    );

  it('an amount rule may point at steps of its own version, or at none', async () => {
    const own = await seedDraftWorkflow(db.platform, tenant);
    await insertRule(own.versionId, own.taskStepId, own.startStepId);
    await insertRule(own.versionId, null, null);
  });

  it('an amount rule cannot point at a step of another version (23503), as step or as approval step', async () => {
    const mine = await seedDraftWorkflow(db.platform, tenant);
    const other = await seedDraftWorkflow(db.platform, tenant);
    expect(await sqlStateOf(() => insertRule(mine.versionId, other.taskStepId, null))).toBe(SqlState.foreignKeyViolation);
    expect(await sqlStateOf(() => insertRule(mine.versionId, null, other.taskStepId))).toBe(SqlState.foreignKeyViolation);
  });

  it('publishing waits for a transaction that is editing the draft, and the late edit does not slip into the published version', async () => {
    const workflow = await seedDraftWorkflow(db.platform, tenant);
    const editor = await db.platform.connect();
    const publisher = await db.platform.connect();
    try {
      await editor.query('BEGIN');
      await editor.query(`UPDATE steps SET name = 'Edited in flight' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, workflow.taskStepId]);
      await publisher.query('BEGIN');
      let published = false;
      const publishing = publisher
        .query(`UPDATE workflow_versions SET status = 'PUBLISHED' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, workflow.versionId])
        .then(() => {
          published = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(published).toBe(false);
      await editor.query('COMMIT');
      await publishing;
      await publisher.query('COMMIT');
      const { rows } = await db.owner.query(`SELECT name FROM steps WHERE id = $1`, [workflow.taskStepId]);
      expect(rows[0].name).toBe('Edited in flight');
    } finally {
      editor.release();
      publisher.release();
    }
  });

  it('an edit that starts while the publication is pending waits for it and then fails (23001)', async () => {
    const workflow = await seedDraftWorkflow(db.platform, tenant);
    const publisher = await db.platform.connect();
    const editor = await db.platform.connect();
    try {
      await publisher.query('BEGIN');
      await publisher.query(`UPDATE workflow_versions SET status = 'PUBLISHED' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, workflow.versionId]);
      await editor.query('BEGIN');
      const editing = editor.query(`UPDATE steps SET name = 'Too late' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, workflow.taskStepId]).then(
        () => undefined,
        (error: { code?: string }) => error.code,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await publisher.query('COMMIT');
      expect(await editing).toBe(SqlState.restrictViolation);
      await editor.query('ROLLBACK');
    } finally {
      editor.release();
      publisher.release();
    }
  });

  it('a version starts at revision 0 and the revision is an ordinary column the API bumps', async () => {
    const workflow = await seedDraftWorkflow(db.platform, tenant);
    expect((await db.owner.query(`SELECT revision FROM workflow_versions WHERE id = $1`, [workflow.versionId])).rows[0].revision).toBe(0);
    await db.platform.query(`UPDATE workflow_versions SET revision = revision + 1 WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, workflow.versionId]);
    expect((await db.owner.query(`SELECT revision FROM workflow_versions WHERE id = $1`, [workflow.versionId])).rows[0].revision).toBe(1);
  });
});
