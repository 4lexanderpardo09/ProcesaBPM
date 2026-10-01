import { Inject, Injectable } from '@nestjs/common';
import type { AcceptInvitationResponse } from '@procesabpm/shared';
import { OneTimeTokenService } from './one-time-token.service.js';

@Injectable()
export class InvitationService {
  constructor(@Inject(OneTimeTokenService) private readonly oneTimeTokens: OneTimeTokenService) {}

  /** Activates the membership; a new user must choose a password, an existing one keeps theirs if none is sent. */
  async accept(token: string, password: string | undefined): Promise<AcceptInvitationResponse> {
    const consumed = await this.oneTimeTokens.consume('INVITATION', token, password);
    if (consumed.invitedTenantId === null) throw new Error('An invitation token without a tenant was consumed');
    return { tenantId: consumed.invitedTenantId };
  }
}
