import type { INestApplication } from '@nestjs/common';
import type { TestDatabase } from '@procesabpm/db/testing/database';
import { insertReturningId, seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import type { StepType, TransitionCondition } from '@procesabpm/shared';
import { adminOf, type ApiClient, clientWith } from './admin-api.js';
import type { GrantedPermission } from './permission-fixtures.js';

export const unique = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;

/** Monday 2026-09-07 09:00 in Bogotá (UTC-5): a working day well in the past, so real-time tokens never look expired by it. */
export const MONDAY_9AM = '2026-09-07T14:00:00Z';

const grant = (action: string): GrantedPermission => ({ action, subject: 'Ticket' });
export const REQUESTER_GRANTS = [grant('create'), grant('read_created')];
export const WORKER_GRANTS = [grant('read_assigned'), grant('transition'), grant('close')];
export const SUPERVISOR_GRANTS = [grant('reassign'), grant('read_all'), grant('transition')];

/** Monday to Friday 08:00-12:00 and 14:00-18:00, and Wednesday 2026-09-09 as a holiday, as the tenant's default calendar. */
export async function seedBusinessCalendar(db: TestDatabase, tenant: SeededTenant): Promise<string> {
  const calendarId = await insertReturningId(db.platform, `INSERT INTO calendars (tenant_id, name, is_default) VALUES ($1, 'Office', true) RETURNING id`, [tenant.tenantId]);
  for (const weekday of [1, 2, 3, 4, 5]) {
    for (const [start, end] of [['08:00', '12:00'], ['14:00', '18:00']]) {
      await db.platform.query(`INSERT INTO calendar_working_hours (tenant_id, calendar_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`, [tenant.tenantId, calendarId, weekday, start, end]);
    }
  }
  await db.platform.query(`INSERT INTO calendar_holidays (tenant_id, calendar_id, date, name) VALUES ($1, $2, '2026-09-09', 'Holiday')`, [tenant.tenantId, calendarId]);
  return calendarId;
}

export interface StepSpec {
  readonly key: string;
  readonly type: StepType;
  readonly name?: string;
  /** Any other step column of the graph request (assignmentMode, slaValue…). */
  readonly extra?: Record<string, unknown>;
  readonly candidates?: ReadonlyArray<Record<string, unknown>>;
  readonly initiators?: ReadonlyArray<Record<string, unknown>>;
  /** Signers of a PARALLEL step. */
  readonly signers?: ReadonlyArray<Record<string, unknown>>;
  readonly slaOverrides?: ReadonlyArray<{ companyId: string; slaValue: number; slaUnit: 'BUSINESS_HOURS' | 'BUSINESS_DAYS' }>;
}
export interface TransitionSpec {
  readonly from: string;
  readonly to: string;
  readonly type: 'DEFAULT' | 'DECISION' | 'CONDITION' | 'SYSTEM_ONLY';
  readonly label?: string;
  readonly condition?: TransitionCondition;
  readonly sortOrder?: number;
}
export interface FieldSpec {
  readonly step: string;
  readonly code: string;
  readonly type: string;
  readonly capture?: 'CREATION' | 'STEP' | 'BOTH';
  readonly isRequired?: boolean;
  readonly isReadOnly?: boolean;
  readonly config?: Record<string, unknown>;
  readonly dataSource?: Record<string, unknown>;
}
export interface RuleSpec {
  readonly step?: string;
  readonly fieldCode: string;
  readonly maxAmount: string;
  readonly action: 'BLOCK' | 'WARN' | 'EXTRA_APPROVAL';
  readonly approvalStep?: string;
  readonly message?: string;
  readonly currencyCode?: string;
  readonly positionId?: string;
  readonly companyId?: string;
}
export interface FlowSpec {
  readonly steps: readonly StepSpec[];
  readonly transitions: readonly TransitionSpec[];
  readonly fields?: readonly FieldSpec[];
  readonly rules?: readonly RuleSpec[];
}

export interface PublishedFlow {
  readonly subcategoryId: string;
  readonly workflowId: string;
  readonly versionId: string;
  readonly step: Readonly<Record<string, string>>;
  /** Transition ids by `from->to` (or the label when given). */
  readonly transition: Readonly<Record<string, string>>;
}

const transitionKey = (spec: TransitionSpec) => spec.label ?? `${spec.from}->${spec.to}`;

/** Fills the draft version of a workflow from a spec through the builder API and publishes it. */
export async function publishVersion(admin: ApiClient, workflowId: string, versionId: string, spec: FlowSpec): Promise<Pick<PublishedFlow, 'step' | 'transition'>> {
  const base = `/workflows/${workflowId}/versions/${versionId}`;
  const people = ['TASK', 'APPROVAL', 'DECISION', 'SIGNATURE'];
  const saved = (
    await admin
      .put(`${base}/graph`, {
        revision: 0,
        steps: spec.steps.map((step) => ({
          id: `new:${step.key}`,
          type: step.type,
          name: step.name ?? step.key,
          ...(people.includes(step.type) ? { assignmentMode: 'CREATOR' } : {}),
          ...step.extra,
        })),
        transitions: spec.transitions.map((entry, index) => ({
          id: `new:t${index}`,
          fromStepId: `new:${entry.from}`,
          toStepId: `new:${entry.to}`,
          type: entry.type,
          label: transitionKey(entry),
          sortOrder: entry.sortOrder ?? index,
          ...(entry.condition === undefined ? {} : { condition: entry.condition }),
        })),
      })
      .expect(200)
  ).body as { idMap: Record<string, string> };
  const id = (key: string) => saved.idMap[`new:${key}`]!;

  for (const step of spec.steps) {
    if (step.candidates !== undefined) await admin.put(`${base}/steps/${id(step.key)}/candidates`, { candidates: step.candidates }).expect(200);
    if (step.signers !== undefined) await admin.put(`${base}/steps/${id(step.key)}/signers`, { signers: step.signers }).expect(200);
    if (step.initiators !== undefined) await admin.put(`${base}/steps/${id(step.key)}/initiators`, { initiators: step.initiators }).expect(200);
    if (step.slaOverrides !== undefined) await admin.put(`${base}/steps/${id(step.key)}/sla-overrides`, { overrides: step.slaOverrides }).expect(200);
  }
  for (const field of spec.fields ?? []) {
    await admin
      .post(`${base}/fields`, { stepId: id(field.step), code: field.code, label: field.code, type: field.type, capture: field.capture ?? 'BOTH', isRequired: field.isRequired ?? false, isReadOnly: field.isReadOnly ?? false, config: field.config ?? {}, dataSource: field.dataSource ?? null })
      .expect(201);
  }
  for (const rule of spec.rules ?? []) {
    await admin
      .post(`${base}/amount-rules`, {
        stepId: rule.step === undefined ? null : id(rule.step),
        fieldCode: rule.fieldCode,
        maxAmount: rule.maxAmount,
        currencyCode: rule.currencyCode ?? 'COP',
        action: rule.action,
        approvalStepId: rule.approvalStep === undefined ? null : id(rule.approvalStep),
        message: rule.message ?? null,
        positionId: rule.positionId ?? null,
        companyId: rule.companyId ?? null,
      })
      .expect(201);
  }
  const published = await admin.post(`${base}/publish`, {});
  if (published.status !== 200) throw new Error(`The test workflow did not publish: ${JSON.stringify(published.body)}`);
  return {
    step: Object.fromEntries(spec.steps.map((step) => [step.key, id(step.key)])),
    transition: Object.fromEntries(spec.transitions.map((entry, index) => [transitionKey(entry), saved.idMap[`new:t${index}`]!])),
  };
}

/** A new category, subcategory and workflow, built from the spec and published as its first version. */
export async function publishFlow(admin: ApiClient, spec: FlowSpec): Promise<PublishedFlow> {
  const category = (await admin.post('/categories', { name: unique('Cat') }).expect(201)).body.id as string;
  const subcategoryId = (await admin.post('/subcategories', { categoryId: category, name: unique('Sub') }).expect(201)).body.id as string;
  const workflow = (await admin.post('/workflows', { subcategoryId, name: unique('Flow') }).expect(201)).body;
  const versionId = workflow.versions[0].id as string;
  return { subcategoryId, workflowId: workflow.id as string, versionId, ...(await publishVersion(admin, workflow.id as string, versionId, spec)) };
}

/** START → TASK (creator) → END: the smallest flow that has a person's step. */
export const simpleFlow = (taskExtra: Record<string, unknown> = {}, task: Partial<StepSpec> = {}): FlowSpec => ({
  steps: [{ key: 'start', type: 'START' }, { key: 'task', type: 'TASK', extra: taskExtra, ...task }, { key: 'end', type: 'END' }],
  transitions: [
    { from: 'start', to: 'task', type: 'DEFAULT' },
    { from: 'task', to: 'end', type: 'DECISION', label: 'Done' },
  ],
});

export interface Member {
  readonly userId: string;
  readonly client: ApiClient;
}

/** A tenant with an administrator, a default business calendar and helpers to add members with their own permissions. */
export class TicketWorld {
  private constructor(
    readonly db: TestDatabase,
    readonly app: INestApplication,
    readonly tenant: SeededTenant,
    readonly admin: ApiClient,
    readonly calendarId: string,
  ) {}

  static async create(db: TestDatabase, app: INestApplication): Promise<TicketWorld> {
    const { tenant, admin } = await adminOf(db, app, await seedTenant(db.platform));
    return new TicketWorld(db, app, tenant, admin, await seedBusinessCalendar(db, tenant));
  }

  async member(grants: readonly GrantedPermission[], attributes: { positionId?: string; departmentId?: string; siteId?: string } = {}): Promise<Member> {
    const client = await clientWith(this.db, this.app, this.tenant, grants);
    const userId = ((await client.get('/auth/me').expect(200)).body.user.id as string);
    for (const [column, value] of Object.entries({ position_id: attributes.positionId, department_id: attributes.departmentId, site_id: attributes.siteId })) {
      if (value !== undefined) await this.db.platform.query(`UPDATE memberships SET ${column} = $1 WHERE tenant_id = $2 AND user_id = $3`, [value, this.tenant.tenantId, userId]);
    }
    return { userId, client };
  }

  position(name = unique('Position')): Promise<string> {
    return insertReturningId(this.db.platform, `INSERT INTO positions (tenant_id, name) VALUES ($1, $2) RETURNING id`, [this.tenant.tenantId, name]);
  }

  async group(members: readonly string[], name = unique('Group')): Promise<string> {
    const groupId = await insertReturningId(this.db.platform, `INSERT INTO groups (tenant_id, name) VALUES ($1, $2) RETURNING id`, [this.tenant.tenantId, name]);
    for (const userId of members) await this.db.platform.query(`INSERT INTO group_members (tenant_id, group_id, user_id) VALUES ($1, $2, $3)`, [this.tenant.tenantId, groupId, userId]);
    return groupId;
  }

  /** All tickets' events, oldest first. */
  async events(ticketId: string): Promise<Array<{ type: string; step_id: string | null; transition_id: string | null; actor_id: string | null; assignee_id: string | null; data: Record<string, unknown> | null }>> {
    return (await this.db.platform.query(`SELECT type, step_id, transition_id, actor_id, assignee_id, data FROM ticket_events WHERE tenant_id = $1 AND ticket_id = $2 ORDER BY seq`, [this.tenant.tenantId, ticketId])).rows;
  }

  async outbox(type: string, ticketId: string): Promise<Array<Record<string, unknown>>> {
    return (await this.db.platform.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM outbox_events WHERE tenant_id = $1 AND type = $2 AND payload->>'ticketId' = $3 ORDER BY id`, [this.tenant.tenantId, type, ticketId])).rows.map((row) => row.payload);
  }

  async visits(ticketId: string) {
    return (await this.db.platform.query<{ id: string; step_id: string; loop: number; exited_at: Date | null; result: string | null; due_at: Date | null; business_minutes: number | null; exit_transition_id: string | null }>(
      `SELECT id, step_id, loop, exited_at, result, due_at, business_minutes, exit_transition_id FROM ticket_step_visits WHERE tenant_id = $1 AND ticket_id = $2 ORDER BY entered_at, id`, [this.tenant.tenantId, ticketId])).rows;
  }

  async clocks(ticketId: string) {
    return (await this.db.platform.query<{ responsible_id: string | null; completed_at: Date | null; result: string | null; due_at: Date | null; started_at: Date; business_minutes: number | null; loop: number; step_id: string; sla_value: number | null; sla_unit: string | null; completion_reason: string | null }>(
      `SELECT responsible_id, completed_at, result, completion_reason, due_at, started_at, business_minutes, loop, step_id, sla_value, sla_unit FROM ticket_sla_clocks WHERE tenant_id = $1 AND ticket_id = $2 ORDER BY started_at, id`, [this.tenant.tenantId, ticketId])).rows;
  }

  async assignees(ticketId: string) {
    return (await this.db.platform.query<{ user_id: string; type: string }>(`SELECT user_id, type FROM ticket_assignees WHERE tenant_id = $1 AND ticket_id = $2 ORDER BY user_id`, [this.tenant.tenantId, ticketId])).rows;
  }

  async ticketRow(ticketId: string) {
    return (await this.db.platform.query<{ status: string; current_step_id: string | null; current_loop: number; closed_at: Date | null; closed_by_id: string | null; number: string; workflow_version_id: string; site_id: string | null; registered_by_id: string | null; creator_id: string }>(
      `SELECT status, current_step_id, current_loop, closed_at, closed_by_id, number::text, workflow_version_id, site_id, registered_by_id, creator_id FROM tickets WHERE tenant_id = $1 AND id = $2`, [this.tenant.tenantId, ticketId])).rows[0]!;
  }
}
