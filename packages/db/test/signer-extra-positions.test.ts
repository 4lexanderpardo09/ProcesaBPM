import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, sqlStateOf, type TestDatabase } from './support/database.js';
import { insertReturningId, insertStep, seedDraftWorkflow, seedTenant, type SeededTenant, type SeededWorkflow } from './support/fixtures.js';

describe('extra positions of a signer', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;
  let flow: SeededWorkflow;
  let positions: string[];
  const signer = (stepId: string, type: string, positionId: string | null) =>
    insertReturningId(db.platform, `INSERT INTO step_signers (tenant_id, step_id, signer_type, position_id) VALUES ($1, $2, $3, $4) RETURNING id`, [tenant.tenantId, stepId, type, positionId]);
  const extra = (stepId: string, signerId: string, positionId: string) =>
    db.platform.query(`INSERT INTO step_signer_positions (tenant_id, step_id, signer_id, position_id) VALUES ($1, $2, $3, $4)`, [tenant.tenantId, stepId, signerId, positionId]);

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
    flow = await seedDraftWorkflow(db.platform, tenant);
    positions = [];
    for (const name of ['Coordinador de cartera', 'Gestor de cartera']) positions.push(await insertReturningId(db.platform, `INSERT INTO positions (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenant.tenantId, `${name} ${Date.now()}`]));
  });

  afterAll(async () => {
    await db.close();
  });

  it('go with a POSITION signer of the same step, and leave with it', async () => {
    const position = await signer(flow.taskStepId, 'POSITION', positions[0]!);
    await extra(flow.taskStepId, position, positions[1]!);
    const creator = await signer(flow.taskStepId, 'CREATOR', null);
    expect(await sqlStateOf(() => extra(flow.taskStepId, creator, positions[1]!))).toBe('23514');
    const otherStep = await insertStep(db.platform, tenant.tenantId, flow.versionId, { type: 'END', name: 'Other' });
    expect(await sqlStateOf(() => extra(otherStep, position, positions[0]!))).toBe('23514');

    await db.platform.query(`DELETE FROM step_signers WHERE tenant_id = $1 AND id = $2`, [tenant.tenantId, position]);
    expect((await db.platform.query(`SELECT 1 FROM step_signer_positions WHERE tenant_id = $1 AND signer_id = $2`, [tenant.tenantId, position])).rowCount).toBe(0);
  });
});
