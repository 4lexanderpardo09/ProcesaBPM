import { Inject, Injectable } from '@nestjs/common';
import { type AcceptInvitationResponse, InvalidTokenError } from '@procesabpm/shared';
import { OneTimeTokenService } from './one-time-token.service.js';

@Injectable()
export class InvitationService {
  constructor(@Inject(OneTimeTokenService) private readonly oneTimeTokens: OneTimeTokenService) {}

  /**
   * Activates the membership. A new user must choose a password; for a user who already has one,
   * sending a password is refused by the database (422): an invitation never changes it.
   */
  async accept(token: string, password: string | undefined): Promise<AcceptInvitationResponse> {
    const consumed = await this.oneTimeTokens.consume('INVITATION', token, password);
    if (consumed.invitedTenantId === null) throw new InvalidTokenError();
    return { tenantId: consumed.invitedTenantId };
  }
}
