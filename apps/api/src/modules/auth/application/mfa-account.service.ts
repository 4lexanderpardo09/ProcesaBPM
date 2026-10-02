import { Inject, Injectable } from '@nestjs/common';
import {
  type BackupCodesResponse,
  type DisableMfaRequest,
  type MfaEnrollment,
  MfaNotEnabledError,
  MfaRequiredByPolicyError,
  type MfaStatusResponse,
} from '@procesabpm/shared';
import type { Principal } from '../../../common/auth/principal.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { MfaRepository } from '../data/mfa.repository.js';
import { AccountAudit } from './account-audit.js';
import { CurrentPasswordVerifier } from './current-password-verifier.js';
import { MfaEnrollmentService } from './mfa-enrollment.service.js';
import { MfaFactorVerifier } from './mfa-factor-verifier.js';

/** Two-step verification managed by a signed-in member from their account. */
@Injectable()
export class MfaAccountService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(MfaRepository) private readonly mfa: MfaRepository,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(MfaEnrollmentService) private readonly enrollment: MfaEnrollmentService,
    @Inject(MfaFactorVerifier) private readonly verifier: MfaFactorVerifier,
    @Inject(CurrentPasswordVerifier) private readonly currentPassword: CurrentPasswordVerifier,
    @Inject(AccountAudit) private readonly audit: AccountAudit,
  ) {}

  async status(principal: Principal): Promise<MfaStatusResponse> {
    const { userId } = principal;
    const { status, requiredByPolicy } = await this.runner.withUserTransaction(userId, async (tx) => ({
      status: await this.mfa.status(tx),
      requiredByPolicy: await this.requiredByPolicy(tx, userId),
    }));
    return { enabled: status.enabled, enabledAt: status.enabledAt?.toISOString() ?? null, backupCodesLeft: status.backupCodesLeft, requiredByPolicy };
  }

  beginEnrollment(principal: Principal): Promise<MfaEnrollment> {
    return this.enrollment.begin(principal.userId);
  }

  /** The first code from the app turns MFA on. The other sessions of the user are signed out; this one keeps working, verified. */
  async confirmEnrollment(principal: Principal, code: string): Promise<BackupCodesResponse> {
    const backupCodes = this.enrollment.newBackupCodes();
    await this.verifier.verify(principal.userId, { code }, false, (tx) => this.mfa.enable(tx, backupCodes.hashes, principal.sessionId));
    await this.audit.record(principal, 'account.mfa_enabled');
    return { backupCodes: backupCodes.displayed };
  }

  /** Needs the password and a code (or a backup code); refused while an organization or the platform requires MFA. */
  async disable(principal: Principal, request: DisableMfaRequest): Promise<void> {
    const { userId } = principal;
    const { enabled, requiredByPolicy } = await this.runner.withUserTransaction(userId, async (tx) => ({
      enabled: (await this.mfa.status(tx)).enabled,
      requiredByPolicy: await this.requiredByPolicy(tx, userId),
    }));
    if (!enabled) throw new MfaNotEnabledError();
    if (requiredByPolicy) throw new MfaRequiredByPolicyError();
    await this.currentPassword.verify(userId, request.password);
    const factor = 'code' in request ? { code: request.code } : { backupCode: request.backupCode };
    await this.verifier.verify(userId, factor, true, (tx) => this.mfa.disable(tx, principal.sessionId));
    await this.audit.record(principal, 'account.mfa_disabled');
  }

  /** Replaces the ten backup codes; the old ones stop working. Needs a current TOTP code. */
  async regenerateBackupCodes(principal: Principal, code: string): Promise<BackupCodesResponse> {
    const { userId } = principal;
    const { enabled } = await this.runner.withUserTransaction(userId, (tx) => this.mfa.status(tx));
    if (!enabled) throw new MfaNotEnabledError();
    const backupCodes = this.enrollment.newBackupCodes();
    await this.verifier.verify(userId, { code }, true, (tx) => this.mfa.replaceBackupCodes(tx, backupCodes.hashes));
    await this.audit.record(principal, 'account.mfa_backup_codes_regenerated');
    return { backupCodes: backupCodes.displayed };
  }

  private async requiredByPolicy(tx: Parameters<CredentialsRepository['isPlatformAdmin']>[0], userId: string): Promise<boolean> {
    return (await this.credentials.isPlatformAdmin(tx, userId)) || (await this.credentials.requiresMfaByMembership(tx, userId));
  }
}
