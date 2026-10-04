import { Inject, Injectable } from '@nestjs/common';
import type { Organization, SelectOrganizationResponse } from '@procesabpm/shared';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { LoginBlockRegistry } from '../../announcements/application/login-block-registry.js';
import { CredentialsRepository, type OrganizationMembership } from '../data/credentials.repository.js';

/** The last part of a sign-in: the organizations to pick from and the single-use token that opens one of them. */
@Injectable()
export class SelectionIssuer {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(LoginBlockRegistry) private readonly blocks: LoginBlockRegistry,
  ) {}

  /** `mfa`: the second factor was verified in this sign-in. */
  async issue(userId: string, mfa: boolean): Promise<SelectOrganizationResponse> {
    const { memberships, platformAdmin } = await this.runner.withUserTransaction(userId, async (tx) => ({
      memberships: await this.credentials.listOrganizations(tx, userId),
      platformAdmin: await this.credentials.isPlatformAdmin(tx, userId),
    }));
    const organizations = await Promise.all(memberships.map((membership) => this.withMaintenance(membership)));
    const selection = await this.tokens.issueSelectionToken(userId, { mfa });
    return { step: 'SELECT_ORGANIZATION', organizations, selectionToken: selection.token, expiresIn: selection.expiresIn, platformAdmin };
  }

  /** Only the user's own organizations are annotated, so nobody learns of a block meant for another one. */
  private async withMaintenance(membership: OrganizationMembership): Promise<Organization> {
    const block = await this.blocks.blockFor({ tenantId: membership.tenantId });
    return { ...membership, maintenance: block === undefined ? null : { title: block.title, endsAt: block.endsAt?.toISOString() ?? null } };
  }
}
