import { Inject, Injectable } from '@nestjs/common';
import type { SelectOrganizationResponse } from '@procesabpm/shared';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { CredentialsRepository } from '../data/credentials.repository.js';

/** The last part of a sign-in: the organizations to pick from and the single-use token that opens one of them. */
@Injectable()
export class SelectionIssuer {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
  ) {}

  /** `mfa`: the second factor was verified in this sign-in. */
  async issue(userId: string, mfa: boolean): Promise<SelectOrganizationResponse> {
    const { organizations, platformAdmin } = await this.runner.withUserTransaction(userId, async (tx) => ({
      organizations: await this.credentials.listOrganizations(tx, userId),
      platformAdmin: await this.credentials.isPlatformAdmin(tx, userId),
    }));
    const selection = await this.tokens.issueSelectionToken(userId, { mfa });
    return { step: 'SELECT_ORGANIZATION', organizations, selectionToken: selection.token, expiresIn: selection.expiresIn, platformAdmin };
  }
}
