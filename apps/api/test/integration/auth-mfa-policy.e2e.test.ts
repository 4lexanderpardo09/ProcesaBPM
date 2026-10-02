import type { INestApplication } from '@nestjs/common';
import { connectTestDatabase, type TestDatabase } from '@procesabpm/db/testing/database';
import { seedTenant, type SeededTenant } from '@procesabpm/db/testing/fixtures';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtTokenService } from '../../src/infrastructure/security/jwt-token-service.js';
import { base32Decode } from '../../src/modules/auth/domain/totp.js';
import { bearer, refreshCookieOf, signIn } from '../support/auth-helpers.js';
import { addMembership, seedUser, type TestUser } from '../support/auth-fixtures.js';
import { createTestApp } from '../support/create-test-app.js';
import { currentCode, enableMfa, logInWithMfa } from '../support/mfa-fixtures.js';
import { grantEverything, seedRole } from '../support/permission-fixtures.js';
import { TestClock } from '../support/test-clock.js';
import { useTestEnvironment } from '../support/test-environment.js';

useTestEnvironment();

describe('an organization that requires two-step verification', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tenant: SeededTenant;
  let other: SeededTenant;
  const clock = new TestClock(new Date());

  const http = () => request(app.getHttpServer());
  const settings = (accessToken: string) => http().get('/settings/security').set(bearer(accessToken));
  const setPolicy = (accessToken: string, mfaRequired: boolean) => http().put('/settings/security').set(bearer(accessToken)).send({ mfaRequired });

  /** An administrator of `of` whose session passed the second factor. */
  async function verifiedAdmin(of: SeededTenant) {
    const user = await seedUser(db, of);
    const mfa = await enableMfa(db, user.userId);
    const selection = await logInWithMfa(app, db, user, mfa, clock.now().getTime());
    const session = await http().post('/auth/select-tenant').set(bearer(selection)).send({ tenantId: of.tenantId }).expect(200);
    return { user, mfa, accessToken: session.body.accessToken as string };
  }

  beforeAll(async () => {
    db = connectTestDatabase();
    [tenant, other] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    await Promise.all([grantEverything(db, tenant), grantEverything(db, other)]);
    ({ app } = await createTestApp({ clock }));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('the policy is off by default and reports how many members have no second factor', async () => {
    const { accessToken } = await verifiedAdmin(tenant);
    await seedUser(db, tenant);
    const body = (await settings(accessToken).expect(200)).body;
    expect(body.mfaRequired).toBe(false);
    expect(body.activeMembersWithoutMfa).toBeGreaterThanOrEqual(1);
  });

  it('an administrator whose session did not pass the second factor cannot turn it on', async () => {
    const plain = await seedUser(db, tenant);
    const session = await signIn(app, plain.email, tenant.tenantId);
    const response = await setPolicy(session.accessToken, true).expect(422);
    expect(response.body.error.code).toBe('MFA_NOT_VERIFIED');
    expect((await settings(session.accessToken).expect(200)).body.mfaRequired).toBe(false);
  });

  it('needs the permission to update settings', async () => {
    const roleId = await seedRole(db, tenant.tenantId, 'No settings');
    const limited: TestUser = await seedUser(db, tenant, undefined, { roleId });
    const session = await signIn(app, limited.email, tenant.tenantId);
    await settings(session.accessToken).expect(403);
    await setPolicy(session.accessToken, true).expect(403);
  });

  it('end to end: turning it on signs members out of the next request, forces their enrollment at login, and their new session works', async () => {
    const policyTenant = await seedTenant(db.platform);
    await grantEverything(db, policyTenant);
    const admin = await verifiedAdmin(policyTenant);
    const member = await seedUser(db, policyTenant);
    const memberSession = await signIn(app, member.email, policyTenant.tenantId);
    await http().get('/auth/me').set(bearer(memberSession.accessToken)).expect(200);

    const enabled = await setPolicy(admin.accessToken, true).expect(200);
    // The tenant's seeded owner and the member have no second factor; the verified administrator has.
    expect(enabled.body).toEqual({ mfaRequired: true, activeMembersWithoutMfa: 2 });

    // The admin passed the factor: still in. The member did not: out at the next request and the next refresh.
    await http().get('/auth/me').set(bearer(admin.accessToken)).expect(200);
    const blocked = await http().get('/auth/me').set(bearer(memberSession.accessToken)).expect(403);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');
    await http().post('/auth/refresh').set('cookie', memberSession.refreshCookie).expect(403);

    // The login asks the member to enroll, naming the policy as the reason.
    const login = await http().post('/auth/login').send({ email: member.email, password: member.password }).expect(200);
    expect(login.body).toMatchObject({ step: 'MFA_ENROLLMENT_REQUIRED', reason: 'TENANT_POLICY' });
    const challenge = login.body.challengeToken as string;
    const begun = await http().post('/auth/login/mfa/enrollment').set(bearer(challenge)).expect(200);
    const confirmed = await http()
      .post('/auth/login/mfa/enrollment/confirm')
      .set(bearer(challenge))
      .send({ code: currentCode(base32Decode(begun.body.secret as string), 0, clock.now().getTime()) })
      .expect(200);
    expect(confirmed.body.organizations).toEqual([expect.objectContaining({ tenantId: policyTenant.tenantId, mfaRequired: true })]);

    const session = await http().post('/auth/select-tenant').set(bearer(confirmed.body.selectionToken)).send({ tenantId: policyTenant.tenantId }).expect(200);
    await http().get('/auth/me').set(bearer(session.body.accessToken)).expect(200);
    const refreshed = await http().post('/auth/refresh').set('cookie', refreshCookieOf(session)!).expect(200);
    await http().get('/auth/me').set(bearer(refreshed.body.accessToken)).expect(200);

    // Turned off again, the plain member is not blocked any more.
    await setPolicy(admin.accessToken, false).expect(200);
  });

  it('refuses a selection token issued without the second factor into an organization that requires it', async () => {
    const policyTenant = await seedTenant(db.platform);
    await grantEverything(db, policyTenant);
    const member = await seedUser(db, policyTenant);
    await db.owner.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [policyTenant.tenantId]);
    const tokens = app.get(JwtTokenService);
    const without = await tokens.issueSelectionToken(member.userId, { mfa: false });
    const refused = await http().post('/auth/select-tenant').set(bearer(without.token)).send({ tenantId: policyTenant.tenantId }).expect(403);
    expect(refused.body.error.code).toBe('MFA_REQUIRED');
    // The refused selection did not burn the token.
    await http().post('/auth/select-tenant').set(bearer(without.token)).send({ tenantId: policyTenant.tenantId }).expect(403);

    const withMfa = await tokens.issueSelectionToken(member.userId, { mfa: true });
    await http().post('/auth/select-tenant').set(bearer(withMfa.token)).send({ tenantId: policyTenant.tenantId }).expect(200);
  });

  it('tenant leak: the policy of one organization never touches another', async () => {
    const policyTenant = await seedTenant(db.platform);
    await grantEverything(db, policyTenant);
    const admin = await verifiedAdmin(policyTenant);
    const outsider = await seedUser(db, other);
    const outsiderSession = await signIn(app, outsider.email, other.tenantId);

    await setPolicy(admin.accessToken, true).expect(200);

    await http().get('/auth/me').set(bearer(outsiderSession.accessToken)).expect(200);
    expect((await http().post('/auth/login').send({ email: outsider.email, password: outsider.password }).expect(200)).body.step).toBe('SELECT_ORGANIZATION');
    const otherAdmin = await seedUser(db, other);
    const otherSession = await signIn(app, otherAdmin.email, other.tenantId);
    expect((await settings(otherSession.accessToken).expect(200)).body.mfaRequired).toBe(false);
    expect((await settings(admin.accessToken).expect(200)).body.mfaRequired).toBe(true);
    // Writing from one organization writes only that organization.
    await setPolicy(otherSession.accessToken, false).expect(200);
    const rows = await db.owner.query<{ mfa_required: boolean }>('SELECT mfa_required FROM tenants WHERE id = $1', [policyTenant.tenantId]);
    expect(rows.rows[0]?.mfa_required).toBe(true);
  });

  it('a member in two organizations is forced to enroll when either requires it (account-wide)', async () => {
    const [first, second] = [await seedTenant(db.platform), await seedTenant(db.platform)];
    const user = await seedUser(db, first);
    await addMembership(db, second, user.userId);
    await db.owner.query('UPDATE tenants SET mfa_required = true WHERE id = $1', [second.tenantId]);
    const login = await http().post('/auth/login').send({ email: user.email, password: user.password }).expect(200);
    expect(login.body).toMatchObject({ step: 'MFA_ENROLLMENT_REQUIRED', reason: 'TENANT_POLICY' });
  });
});
