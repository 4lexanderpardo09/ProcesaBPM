import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InvalidCredentialsError, type LoginRequest, type LoginResponse, MfaNotImplementedError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import { CredentialsRepository } from '../data/credentials.repository.js';
import { canAttemptLogin } from '../domain/login-eligibility.js';

@Injectable()
export class LoginService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /**
   * Unknown e-mail, wrong password, locked or disabled account: the same error after the same work
   * (one Argon2id verification and one attempt update), so neither the answer nor its timing tells
   * them apart. While an account is locked its attempts are not counted, so the lockout does not grow.
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    const candidate = await this.runner.withAnonymousTransaction((tx) =>
      this.credentials.findLoginCandidate(tx, request.email),
    );
    const eligible = candidate !== undefined && canAttemptLogin(candidate, this.clock.now());
    const passwordMatches = await this.hasher.verify(eligible ? candidate.passwordHash : null, request.password);

    if (!eligible || !passwordMatches) {
      await this.registerAttempt(eligible ? candidate.id : randomUUID(), false);
      throw new InvalidCredentialsError();
    }
    if (candidate.mfaEnabled) throw new MfaNotImplementedError();

    await this.registerAttempt(candidate.id, true);
    const organizations = await this.runner.withUserTransaction(candidate.id, (tx) =>
      this.credentials.listOrganizations(tx, candidate.id),
    );
    const selection = await this.tokens.issueSelectionToken(candidate.id);
    return { organizations, selectionToken: selection.token, expiresIn: selection.expiresIn };
  }

  /** A random id matches no row: the decoy update keeps the work identical for unknown accounts. */
  private registerAttempt(userId: string, success: boolean): Promise<void> {
    return this.runner.withAnonymousTransaction((tx) => this.credentials.registerLoginAttempt(tx, userId, success));
  }
}
