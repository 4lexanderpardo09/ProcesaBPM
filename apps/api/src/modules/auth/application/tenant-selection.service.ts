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

  /** Opens a session on a tenant where the user who logged in has an ACTIVE membership. */
  async select(selectionToken: string, tenantId: string, client: ClientInfo): Promise<OpenedSession> {
    const userId = await this.tokens.verifySelectionToken(selectionToken);
    await this.tenantAccess.verify({ userId, tenantId });
    return this.sessions.open(userId, tenantId, client);
  }
}
