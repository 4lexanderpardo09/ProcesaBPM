import { Inject, Injectable } from '@nestjs/common';
import {
  type MfaEnrollment,
  type MfaEnrollmentConfirmedResponse,
  type MfaFactor,
  type MfaLoginResponse,
  UnauthenticatedError,
} from '@procesabpm/shared';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { JwtTokenService, type MfaChallengeClaims } from '../../../infrastructure/security/jwt-token-service.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { LoginTokenRepository } from '../data/login-token.repository.js';
import { MfaRepository } from '../data/mfa.repository.js';
import { MfaEnrollmentService } from './mfa-enrollment.service.js';
import { MfaFactorVerifier } from './mfa-factor-verifier.js';
import { SecurityNotifier } from './security-notifier.js';
import { SelectionIssuer } from './selection-issuer.js';

/**
 * The second step of the sign-in. Each route takes the challenge token the login returned (proof of the password); the
 * challenge is consumed in the same transaction that accepts the factor, so a wrong code does not burn it (the attempt
 * counter bounds the retries) and a right one cannot be replayed.
 */
@Injectable()
export class MfaLoginService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(MfaFactorVerifier) private readonly verifier: MfaFactorVerifier,
    @Inject(MfaEnrollmentService) private readonly enrollment: MfaEnrollmentService,
    @Inject(MfaRepository) private readonly mfa: MfaRepository,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(LoginTokenRepository) private readonly loginTokens: LoginTokenRepository,
    @Inject(SelectionIssuer) private readonly selection: SelectionIssuer,
    @Inject(SecurityNotifier) private readonly notifier: SecurityNotifier,
  ) {}

  /** The user has the second factor: a right code completes the sign-in. */
  async verify(challengeToken: string, factor: MfaFactor): Promise<MfaLoginResponse> {
    const challenge = await this.tokens.verifyMfaChallenge(challengeToken, 'VERIFY');
    const { userId } = challenge;
    const verified = await this.verifier.verify(userId, factor, true, async (tx) => {
      await this.consumeChallenge(tx, challenge);
      await this.credentials.recordPasswordSuccess(tx, userId, true);
    });
    const completed = await this.selection.issue(userId, true);
    return verified.backupCodesLeft === undefined ? completed : { ...completed, backupCodesLeft: verified.backupCodesLeft };
  }

  /** The user must enroll: a new secret for the authenticator app (the previous pending one, if any, is replaced). */
  async beginEnrollment(challengeToken: string): Promise<MfaEnrollment> {
    const challenge = await this.tokens.verifyMfaChallenge(challengeToken, 'ENROLL');
    return this.enrollment.begin(challenge.userId);
  }

  /** The first code proves the app has the secret: MFA is on, the backup codes are shown once, and the sign-in completes. */
  async confirmEnrollment(challengeToken: string, code: string): Promise<MfaEnrollmentConfirmedResponse> {
    const challenge = await this.tokens.verifyMfaChallenge(challengeToken, 'ENROLL');
    const { userId } = challenge;
    const backupCodes = this.enrollment.newBackupCodes();
    await this.verifier.verify(userId, { code }, false, async (tx) => {
      await this.consumeChallenge(tx, challenge);
      await this.mfa.enable(tx, backupCodes.hashes, null);
      await this.notifier.notify(tx, userId, 'MFA_ENABLED');
      await this.credentials.recordPasswordSuccess(tx, userId, true);
    });
    return { ...(await this.selection.issue(userId, true)), backupCodes: backupCodes.displayed };
  }

  private async consumeChallenge(tx: Parameters<LoginTokenRepository['consume']>[0], challenge: MfaChallengeClaims): Promise<void> {
    if (!(await this.loginTokens.consume(tx, challenge, 'MFA_CHALLENGE'))) throw new UnauthenticatedError();
  }
}
