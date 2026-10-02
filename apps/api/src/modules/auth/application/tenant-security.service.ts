import { Inject, Injectable } from '@nestjs/common';
import { MfaNotVerifiedError, type TenantSecuritySettings, type TenantSecuritySettingsResponse } from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { TenantSecurityRepository } from '../data/tenant-security.repository.js';

@Injectable()
export class TenantSecurityService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantSecurityRepository) private readonly security: TenantSecurityRepository,
  ) {}

  get(principal: Principal): Promise<TenantSecuritySettingsResponse> {
    return this.runner.withTenantTransaction((tx) => this.read(tx, principal.tenantId));
  }

  /**
   * Turning the policy on signs out, at their next request, every member who has no second factor. The administrator
   * who does it must have passed the factor in this very session, so they cannot lock themselves out.
   */
  update(principal: Principal, settings: TenantSecuritySettings): Promise<TenantSecuritySettingsResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = principal;
      if (settings.mfaRequired && !(await this.security.sessionMfaVerified(tx, principal.sessionId))) throw new MfaNotVerifiedError();
      await this.security.setMfaRequired(tx, tenantId, settings.mfaRequired);
      return this.read(tx, tenantId);
    });
  }

  private async read(tx: Parameters<TenantSecurityRepository['mfaRequired']>[0], tenantId: string): Promise<TenantSecuritySettingsResponse> {
    return {
      mfaRequired: await this.security.mfaRequired(tx, tenantId),
      activeMembersWithoutMfa: await this.security.activeMembersWithoutMfa(tx, tenantId),
    };
  }
}
