import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, type TestDatabase } from './support/database.js';
import {
  insertStep,
  publishVersion,
  seedDraftWorkflow,
  seedTenant,
  type SeededTenant,
  type SeededWorkflow,
} from './support/fixtures.js';

describe('workflow configuration rules', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
  });

  afterAll(async () => {
    await db.close();
  });

  const addTransition = (workflow: SeededWorkflow, from: string, to: string, type: string, label: string) =>
    db.platform.query(
      `INSERT INTO transitions (tenant_id, version_id, from_step_id, to_step_id, type, label) VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenant.tenantId, workflow.versionId, from, to, type, label],
    );

  describe('published versions are immutable', () => {
    let published: SeededWorkflow;

    beforeAll(async () => {
      published = await seedDraftWorkflow(db.platform, tenant);
      await publishVersion(db.platform, tenant.tenantId, published.versionId);
    });

    it('rejects editing, adding or deleting steps', async () => {
      const edit = () => db.platform.query(`UPDATE steps SET name = 'Changed' WHERE tenant_id = $1 AND id = $2`, [
        tenant.tenantId,
        published.taskStepId,
      ]);
      const add = () => insertStep(db.platform, tenant.tenantId, published.versionId, { type: 'END', name: 'End' });
      const remove = () => db.platform.query(`DELETE FROM steps WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, published.taskStepId]);

      expect(await sqlStateOf(edit)).toBe(SqlState.restrictViolation);
      expect(await sqlStateOf(add)).toBe(SqlState.restrictViolation);
      expect(await sqlStateOf(remove)).toBe(SqlState.restrictViolation);
    });

    it('rejects changes to transitions, fields and step children', async () => {
      const relabel = () => db.platform.query(`UPDATE transitions SET label = 'Other' WHERE tenant_id = $1 AND version_id = $2`, [
        tenant.tenantId,
        published.versionId,
      ]);
      const addField = () => db.platform.query(
        `INSERT INTO fields (tenant_id, version_id, step_id, code, label, type) VALUES ($1, $2, $3, 'NEW_FIELD', 'New', 'TEXT')`,
        [tenant.tenantId, published.versionId, published.taskStepId],
      );
      const addCandidate = () => db.platform.query(
        `INSERT INTO step_candidates (tenant_id, step_id, participant_type, user_id) VALUES ($1, $2, 'USER', $3)`,
        [tenant.tenantId, published.taskStepId, tenant.userId],
      );

      expect(await sqlStateOf(relabel)).toBe(SqlState.restrictViolation);
      expect(await sqlStateOf(addField)).toBe(SqlState.restrictViolation);
      expect(await sqlStateOf(addCandidate)).toBe(SqlState.restrictViolation);
    });

    it('only moves forward in its lifecycle and cannot be deleted', async () => {
      const backToDraft = () => db.platform.query(`UPDATE workflow_versions SET status = 'DRAFT' WHERE tenant_id = $1 AND id = $2`, [
        tenant.tenantId,
        published.versionId,
      ]);
      const remove = () => db.platform.query(`DELETE FROM workflow_versions WHERE tenant_id = $1 AND id = $2`, [
        tenant.tenantId,
        published.versionId,
      ]);

      expect(await sqlStateOf(backToDraft)).toBe(SqlState.restrictViolation);
      expect(await sqlStateOf(remove)).toBe(SqlState.restrictViolation);
      await expect(
        db.platform.query(`UPDATE workflow_versions SET status = 'ARCHIVED' WHERE tenant_id = $1 AND id = $2`, [
          tenant.tenantId,
          published.versionId,
        ]),
      ).resolves.toBeDefined();
    });

    it('records when it was published', async () => {
      const { rows } = await db.platform.query<{ published_at: Date | null }>(
        'SELECT published_at FROM workflow_versions WHERE tenant_id = $1 AND id = $2',
        [tenant.tenantId, published.versionId],
      );

      expect(rows[0]?.published_at).toBeInstanceOf(Date);
    });
  });

  it('allows editing and deleting configuration while the version is a draft', async () => {
    const draft = await seedDraftWorkflow(db.platform, tenant);

    await db.platform.query(`UPDATE steps SET name = 'Renamed' WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, draft.taskStepId]);
    await db.platform.query(`DELETE FROM workflow_versions WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, draft.versionId]);

    const { rowCount } = await db.platform.query('SELECT 1 FROM steps WHERE tenant_id = $1 AND version_id = $2', [
      tenant.tenantId,
      draft.versionId,
    ]);
    expect(rowCount).toBe(0);
  });

  it('keeps a workflow attached to its subcategory forever', async () => {
    const draft = await seedDraftWorkflow(db.platform, tenant);
    const other = await seedDraftWorkflow(db.platform, tenant);

    const move = () => db.platform.query(`UPDATE workflows SET subcategory_id = $1 WHERE tenant_id = $2 AND id = $3`, [
      other.subcategoryId,
      tenant.tenantId,
      draft.workflowId,
    ]);

    expect(await sqlStateOf(move)).toBe(SqlState.restrictViolation);
  });

  describe('step types', () => {
    it('rejects an automatic block with a responsible or an SLA', async () => {
      const draft = await seedDraftWorkflow(db.platform, tenant);
      const conditionWithAssignee = () => db.platform.query(
        `INSERT INTO steps (tenant_id, version_id, type, name, assignment_mode) VALUES ($1, $2, 'CONDITION', 'c', 'USERS')`,
        [tenant.tenantId, draft.versionId],
      );
      const conditionWithSla = () => db.platform.query(
        `INSERT INTO steps (tenant_id, version_id, type, name, sla_value, sla_unit) VALUES ($1, $2, 'CONDITION', 'c', 4, 'BUSINESS_HOURS')`,
        [tenant.tenantId, draft.versionId],
      );

      expect(await sqlStateOf(conditionWithAssignee)).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(conditionWithSla)).toBe(SqlState.checkViolation);
    });

    it('rejects a step handled by a person without an assignment mode', async () => {
      const draft = await seedDraftWorkflow(db.platform, tenant);

      const unassignedTask = () => insertStep(db.platform, tenant.tenantId, draft.versionId, { type: 'TASK', name: 'Nobody' });

      expect(await sqlStateOf(unassignedTask)).toBe(SqlState.checkViolation);
    });

    it('rejects changing the type of a step that already has transitions', async () => {
      const draft = await seedDraftWorkflow(db.platform, tenant);

      const retype = () => db.platform.query(`UPDATE steps SET type = 'APPROVAL' WHERE tenant_id = $1 AND id = $2`, [
        tenant.tenantId,
        draft.taskStepId,
      ]);

      expect(await sqlStateOf(retype)).toBe(SqlState.checkViolation);
    });
  });

  describe('transitions', () => {
    let draft: SeededWorkflow;
    let endStepId: string;
    let conditionStepId: string;

    beforeAll(async () => {
      draft = await seedDraftWorkflow(db.platform, tenant);
      endStepId = await insertStep(db.platform, tenant.tenantId, draft.versionId, { type: 'END', name: 'End' });
      conditionStepId = await insertStep(db.platform, tenant.tenantId, draft.versionId, { type: 'CONDITION', name: 'Check' });
    });

    it('never leave an END step nor enter a START step', async () => {
      expect(await sqlStateOf(() => addTransition(draft, endStepId, draft.taskStepId, 'SYSTEM_ONLY', 'Back'))).toBe(
        SqlState.checkViolation,
      );
      expect(await sqlStateOf(() => addTransition(draft, draft.taskStepId, draft.startStepId, 'DECISION', 'Restart'))).toBe(
        SqlState.checkViolation,
      );
    });

    it('match the kind of step they leave', async () => {
      expect(await sqlStateOf(() => addTransition(draft, draft.startStepId, endStepId, 'DECISION', 'Pick'))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => addTransition(draft, draft.taskStepId, endStepId, 'CONDITION', 'Auto'))).toBe(SqlState.checkViolation);
      expect(await sqlStateOf(() => addTransition(draft, conditionStepId, endStepId, 'DECISION', 'Pick'))).toBe(SqlState.checkViolation);
    });

    it('require a rule on CONDITION branches and allow a single DEFAULT branch', async () => {
      const withoutRule = () => addTransition(draft, conditionStepId, endStepId, 'CONDITION', 'Bank');
      expect(await sqlStateOf(withoutRule)).toBe(SqlState.checkViolation);

      await addTransition(draft, conditionStepId, endStepId, 'DEFAULT', 'Otherwise');
      expect(await sqlStateOf(() => addTransition(draft, conditionStepId, draft.taskStepId, 'DEFAULT', 'Else'))).toBe(
        SqlState.uniqueViolation,
      );
    });

    it('do not repeat a label on the same step', async () => {
      await addTransition(draft, draft.taskStepId, endStepId, 'DECISION', 'Approve');

      expect(await sqlStateOf(() => addTransition(draft, draft.taskStepId, draft.taskStepId, 'DECISION', 'approve'))).toBe(
        SqlState.uniqueViolation,
      );
    });

    it('allow a step to loop back to itself (rework loops)', async () => {
      await expect(addTransition(draft, draft.taskStepId, draft.taskStepId, 'DECISION', 'Rework')).resolves.toBeDefined();
    });
  });
});
