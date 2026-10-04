import { UnauthenticatedError } from '@procesabpm/shared';
import { describe, expect, it, vi } from 'vitest';
import type { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { AccessTokenAuthenticator } from './access-token-authenticator.js';
import type { TenantAccessService } from './tenant-access.service.js';

const claims = { sub: '018f3c1e-7b2a-7c3d-9e4f-0123456789ab', tid: '018f3c1e-7b2a-7c3d-9e4f-0123456789ac', sid: '018f3c1e-7b2a-7c3d-9e4f-0123456789ad' };
const access = { roleId: 'role', roleActive: true, roleIsAdmin: false, permissionsVersion: 3, isOwner: false, departmentId: 'd', siteId: null, positionId: null, tenantMode: 'ACTIVE' };

function setup() {
  const expiresAt = new Date('2026-10-03T12:15:00Z');
  const inspectAccessToken = vi.fn().mockResolvedValue({ claims, expiresAt });
  const verify = vi.fn().mockResolvedValue(access);
  const authenticator = new AccessTokenAuthenticator({ inspectAccessToken } as unknown as JwtTokenService, { verify } as unknown as TenantAccessService);
  return { authenticator, inspectAccessToken, verify, expiresAt };
}

describe('AccessTokenAuthenticator', () => {
  it('turns a valid token into the principal read from the database, with the token expiry', async () => {
    const { authenticator, verify, expiresAt } = setup();
    const result = await authenticator.authenticate('token');
    expect(verify).toHaveBeenCalledWith({ userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid, allowDeletionPending: false });
    expect(result.expiresAt).toBe(expiresAt);
    expect(result.principal).toEqual({
      userId: claims.sub,
      tenantId: claims.tid,
      sessionId: claims.sid,
      roleId: 'role',
      roleActive: true,
      roleIsAdmin: false,
      isOwner: false,
      permissionsVersion: 3,
      membership: { departmentId: 'd', siteId: null, positionId: null },
      tenantMode: 'ACTIVE',
    });
  });

  it('lets a full-access member into an organization pending deletion only when the caller asks for it (HTTP, never real time)', async () => {
    const { authenticator, verify } = setup();
    verify.mockResolvedValue({ ...access, tenantMode: 'DELETION_PENDING' });
    const http = await authenticator.authenticate('token', { allowDeletionPending: true });
    expect(verify).toHaveBeenLastCalledWith(expect.objectContaining({ allowDeletionPending: true }));
    expect(http.principal.tenantMode).toBe('DELETION_PENDING');
    await authenticator.reverify({ userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid });
    expect(verify).toHaveBeenLastCalledWith(expect.objectContaining({ allowDeletionPending: false }));
  });

  it('never reads the database for a token that does not verify', async () => {
    const { authenticator, inspectAccessToken, verify } = setup();
    inspectAccessToken.mockRejectedValue(new UnauthenticatedError());
    await expect(authenticator.authenticate('bad')).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(verify).not.toHaveBeenCalled();
  });

  it('re-verifies an identity without a token', async () => {
    const { authenticator, inspectAccessToken } = setup();
    const principal = await authenticator.reverify({ userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid });
    expect(principal.permissionsVersion).toBe(3);
    expect(inspectAccessToken).not.toHaveBeenCalled();
  });

  it('lets the database refusal (revoked session, MFA policy…) through', async () => {
    const { authenticator, verify } = setup();
    verify.mockRejectedValue(new UnauthenticatedError());
    await expect(authenticator.reverify({ userId: claims.sub, tenantId: claims.tid, sessionId: claims.sid })).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
