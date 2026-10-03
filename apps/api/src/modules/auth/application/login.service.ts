import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InvalidCredentialsError, type LoginRequest, type LoginResponse } from '@procesabpm/shared';
import { BackgroundTasks } from '../../../common/background/background-tasks.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import type { LoginCandidate } from '../domain/login-candidate.js';
import { decideLoginStep } from '../domain/login-step.js';
import { SecurityNotifier } from './security-notifier.js';
import { SelectionIssuer } from './selection-issuer.js';

@Injectable()
export class LoginService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(SelectionIssuer) private readonly selection: SelectionIssuer,
    @Inject(SecurityNotifier) private readonly notifier: SecurityNotifier,
    @Inject(BackgroundTasks) private readonly background: BackgroundTasks,
  ) {}

  /**
   * Unknown e-mail, wrong password, locked or disabled account: the same error after the same work (one attempt
   * claim and one Argon2id verification), so neither the answer nor its timing tells them apart. The attempt is claimed
   * (and committed) BEFORE the password is checked: a burst of parallel requests cannot test more passwords than the
   * lockout allows, and a locked account is never tested against its real hash. When the attempt that locked the account
   * was wrong, its owner is told in the background (the database sends one such notice per day at most).
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    const candidate = await this.runner.withAnonymousTransaction((tx) =>
      this.credentials.findLoginCandidate(tx, request.email),
    );
    // A random id matches no row: the claim for an unknown account does the same work and is refused.
    const claim = await this.runner.withAnonymousTransaction((tx) =>
      this.credentials.claimLoginAttempt(tx, candidate?.id ?? randomUUID()),
    );
    const usable = claim.claimed && candidate !== undefined;
    const passwordMatches = await this.hasher.verify(usable ? candidate.passwordHash : null, request.password);
    if (usable && passwordMatches) return this.nextStep(candidate);
    if (usable && claim.locking) {
      // In the background: the extra transaction must not make the locking attempt slower than the unknown-account path.
      this.background.run('login.lockout-notice', () => this.notifier.notifyLockout(candidate.id, 'ACCOUNT_LOCKED'));
    }
    throw new InvalidCredentialsError();
  }

  /** After a correct password: the second factor, the enrollment it forces, or the organization picker. */
  private async nextStep(candidate: LoginCandidate): Promise<LoginResponse> {
    const { id } = candidate;
    const facts = await this.runner.withUserTransaction(id, async (tx) => ({
      mfaEnabled: candidate.mfaEnabled,
      platformAdmin: await this.credentials.isPlatformAdmin(tx, id),
      tenantRequiresMfa: await this.credentials.requiresMfaByMembership(tx, id),
    }));
    const step = decideLoginStep(facts);
    // `last_login_at` is stamped when the sign-in is complete; a pending second factor gives the password slot back only.
    await this.runner.withAnonymousTransaction((tx) => this.credentials.recordPasswordSuccess(tx, id, step.kind === 'SELECT_ORGANIZATION'));

    if (step.kind === 'SELECT_ORGANIZATION') return this.selection.issue(id, false);
    if (step.kind === 'MFA_REQUIRED') {
      const challenge = await this.tokens.issueMfaChallenge(id, 'VERIFY');
      return { step: 'MFA_REQUIRED', challengeToken: challenge.token, expiresIn: challenge.expiresIn, methods: ['TOTP', 'BACKUP_CODE'] };
    }
    const challenge = await this.tokens.issueMfaChallenge(id, 'ENROLL');
    return { step: 'MFA_ENROLLMENT_REQUIRED', challengeToken: challenge.token, expiresIn: challenge.expiresIn, reason: step.reason };
  }
}
