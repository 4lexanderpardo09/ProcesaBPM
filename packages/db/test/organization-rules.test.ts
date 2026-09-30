import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectTestDatabase, SqlState, sqlStateOf, type TestDatabase } from './support/database.js';
import { insertReturningId, seedMember, seedTenant, withPlatformTransaction, type SeededTenant } from './support/fixtures.js';

describe('organization rules', () => {
  let db: TestDatabase;
  let tenant: SeededTenant;

  beforeAll(async () => {
    db = connectTestDatabase();
    tenant = await seedTenant(db.platform);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('approval groups', () => {
    let typeId: string;
    let secondCompanyId: string;

    const createGroup = (name: string, companyId: string | null) =>
      insertReturningId(
        db.platform,
        `INSERT INTO approval_groups (tenant_id, type_id, company_id, name) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenant.tenantId, typeId, companyId, name],
      );
    const addMember = (groupId: string, userId: string) =>
      db.platform.query(
        `INSERT INTO approval_group_members (tenant_id, group_id, type_id, user_id) VALUES ($1, $2, $3, $4)`,
        [tenant.tenantId, groupId, typeId, userId],
      );

    beforeAll(async () => {
      typeId = await insertReturningId(
        db.platform,
        `INSERT INTO approval_group_types (tenant_id, name) VALUES ($1, 'Purchases') RETURNING id`,
        [tenant.tenantId],
      );
      secondCompanyId = await insertReturningId(
        db.platform,
        `INSERT INTO companies (tenant_id, name, country_code, currency_code, time_zone)
         VALUES ($1, 'Second company', 'CO', 'COP', 'America/Bogota') RETURNING id`,
        [tenant.tenantId],
      );
    });

    it('allow a general group plus one group per company for the same person and type', async () => {
      const memberId = await seedMember(db.platform, tenant);
      const general = await createGroup('General purchases', null);
      const perCompany = await createGroup('Second company purchases', secondCompanyId);

      await addMember(general, memberId);
      await expect(addMember(perCompany, memberId)).resolves.toBeDefined();
    });

    it('reject two general groups of the same type for the same person', async () => {
      const memberId = await seedMember(db.platform, tenant);
      const first = await createGroup('North purchases', null);
      const second = await createGroup('South purchases', null);

      await addMember(first, memberId);
      expect(await sqlStateOf(() => addMember(second, memberId))).toBe(SqlState.uniqueViolation);
    });

    it('copy type and company from the group, ignoring what the caller sends', async () => {
      const memberId = await seedMember(db.platform, tenant);
      const groupId = await createGroup('Copied scope', secondCompanyId);
      const otherTypeId = await insertReturningId(
        db.platform,
        `INSERT INTO approval_group_types (tenant_id, name) VALUES ($1, $2) RETURNING id`,
        [tenant.tenantId, `Travel ${Date.now()}`],
      );

      await db.platform.query(
        `INSERT INTO approval_group_members (tenant_id, group_id, type_id, company_id, user_id) VALUES ($1, $2, $3, NULL, $4)`,
        [tenant.tenantId, groupId, otherTypeId, memberId],
      );

      const { rows } = await db.platform.query<{ type_id: string; company_id: string }>(
        'SELECT type_id, company_id FROM approval_group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, memberId],
      );
      expect(rows[0]).toEqual({ type_id: typeId, company_id: secondCompanyId });
    });

    it('reject changing the type or company of a group that has members', async () => {
      const memberId = await seedMember(db.platform, tenant);
      const groupId = await createGroup('Locked scope', null);
      await addMember(groupId, memberId);

      const moveGroup = () => db.platform.query(`UPDATE approval_groups SET company_id = $1 WHERE tenant_id = $2 AND id = $3`, [
        secondCompanyId,
        tenant.tenantId,
        groupId,
      ]);

      expect(await sqlStateOf(moveGroup)).toBe(SqlState.checkViolation);
    });
  });

  describe('delegations', () => {
    const delegate = (from: string, to: string, startsAt: string, endsAt: string) =>
      db.platform.query(
        `INSERT INTO delegations (tenant_id, from_user_id, to_user_id, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)`,
        [tenant.tenantId, from, to, startsAt, endsAt],
      );

    it('cannot overlap for the same person', async () => {
      const [boss, first, second] = await Promise.all([1, 2, 3].map(() => seedMember(db.platform, tenant)));
      await delegate(boss!, first!, '2026-10-01', '2026-10-10');

      expect(await sqlStateOf(() => delegate(boss!, second!, '2026-10-05', '2026-10-15'))).toBe(SqlState.exclusionViolation);
      await expect(delegate(boss!, second!, '2026-10-10', '2026-10-20')).resolves.toBeDefined();
    });

    it('cannot point back at each other in the same period', async () => {
      const [a, b] = await Promise.all([1, 2].map(() => seedMember(db.platform, tenant)));
      await delegate(a!, b!, '2026-11-01', '2026-11-10');

      expect(await sqlStateOf(() => delegate(b!, a!, '2026-11-05', '2026-11-08'))).toBe(SqlState.checkViolation);
    });
  });

  describe('calendars', () => {
    it('reject overlapping working shifts on the same weekday', async () => {
      const calendarId = await insertReturningId(
        db.platform,
        `INSERT INTO calendars (tenant_id, name) VALUES ($1, $2) RETURNING id`,
        [tenant.tenantId, `Calendar ${Date.now()}`],
      );
      const addShift = (weekday: number, start: string, end: string) =>
        db.platform.query(
          `INSERT INTO calendar_working_hours (tenant_id, calendar_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
          [tenant.tenantId, calendarId, weekday, start, end],
        );

      await addShift(1, '08:00', '12:00');
      await addShift(1, '14:00', '18:00');
      await addShift(2, '11:00', '13:00');

      expect(await sqlStateOf(() => addShift(1, '11:00', '13:00'))).toBe(SqlState.exclusionViolation);
    });
  });

  describe('memberships', () => {
    it('require an active member to belong to at least one company', async () => {
      const userId = await insertReturningId(
        db.platform,
        `INSERT INTO users (email, first_name, last_name) VALUES ($1, 'No', 'Company') RETURNING id`,
        [`no-company-${Date.now()}@example.com`],
      );

      const withoutCompany = () => db.platform.query(
        `INSERT INTO memberships (tenant_id, user_id, role_id, status) VALUES ($1, $2, $3, 'ACTIVE')`,
        [tenant.tenantId, userId, tenant.roleId],
      );

      expect(await sqlStateOf(withoutCompany)).toBe(SqlState.checkViolation);
    });

    it('reject removing the last company of an active member', async () => {
      const memberId = await seedMember(db.platform, tenant);

      const removeLast = () => withPlatformTransaction(db.platform, (tx) =>
        tx.query('DELETE FROM membership_companies WHERE tenant_id = $1 AND user_id = $2', [tenant.tenantId, memberId]),
      );

      expect(await sqlStateOf(removeLast)).toBe(SqlState.checkViolation);
    });
  });
});
