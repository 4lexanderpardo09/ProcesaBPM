import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InvalidCredentialsError, type LoginRequest, type LoginResponse, MfaNotImplementedError } from '@procesabpm/shared';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { JwtTokenService } from '../../../infrastructure/security/jwt-token-service.js';
import { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import { CredentialsRepository } from '../data/credentials.repository.js';

@Injectable()
export class LoginService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(JwtTokenService) private readonly tokens: JwtTokenService,
  ) {}

  /**
   * Unknown e-mail, wrong password, locked or disabled account: the same error after the same work (one attempt
   * claim and one Argon2id verification), so neither the answer nor its timing tells them apart. The attempt is claimed
   * (and committed) BEFORE the password is checked: a burst of parallel requests cannot test more passwords than the
   * lockout allows, and a locked account is never tested against its real hash.
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    const candidate = await this.runner.withAnonymousTransaction((tx) =>
      this.credentials.findLoginCandidate(tx, request.email),
    );
    // A random id matches no row: the claim for an unknown account does the same work and is refused.
    const claimed = await this.runner.withAnonymousTransaction((tx) =>
      this.credentials.claimLoginAttempt(tx, candidate?.id ?? randomUUID()),
    );
    const usable = claimed && candidate !== undefined;
    const passwordMatches = await this.hasher.verify(usable ? candidate.passwordHash : null, request.password);
    if (!usable || !passwordMatches) throw new InvalidCredentialsError();
    if (candidate.mfaEnabled) throw new MfaNotImplementedError();

    await this.runner.withAnonymousTransaction((tx) => this.credentials.recordPasswordSuccess(tx, candidate.id, true));
    const { organizations, platformAdmin } = await this.runner.withUserTransaction(candidate.id, async (tx) => ({
      organizations: await this.credentials.listOrganizations(tx, candidate.id),
      platformAdmin: await this.credentials.isPlatformAdmin(tx, candidate.id),
    }));
    const selection = await this.tokens.issueSelectionToken(candidate.id);
    return { organizations, selectionToken: selection.token, expiresIn: selection.expiresIn, platformAdmin };
  }
}
