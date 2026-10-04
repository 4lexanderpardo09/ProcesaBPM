import { Inject, Injectable } from '@nestjs/common';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { type ClientInfo, type OpenedSession, SessionService } from './session.service.js';
import { TenantAccessService } from './tenant-access.service.js';

@Injectable()
export class TenantSelectionService {
  constructor(
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(TenantAccessService) private readonly tenantAccess: TenantAccessService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /**
   * Opens a session on a tenant where the user who logged in has an ACTIVE membership. The selection token works once. A
   * member with full access may also open one on an organization pending deletion, to export its data.
   */
  async select(selectionToken: string, tenantId: string, client: ClientInfo): Promise<OpenedSession> {
    const selection = await this.tokens.verifySelectionToken(selectionToken);
    await this.tenantAccess.verify({ userId: selection.userId, tenantId, mfaVerified: selection.mfa, allowDeletionPending: true });
    return this.sessions.openFromSelection(selection, tenantId, client);
  }
}
