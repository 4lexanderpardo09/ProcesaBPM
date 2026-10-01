import { Inject, Injectable } from '@nestjs/common';
import { InvalidTokenError, mapDatabaseError, PermissionDeniedError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { PasswordHasher } from '../../../infrastructure/security/password-hasher.js';
import { sha256Hex } from '../../../infrastructure/security/token-utils.js';
import { type ConsumedUserToken, CredentialsRepository, type UserTokenType } from '../data/credentials.repository.js';

/** Consumes the e-mailed one-time tokens (password reset, invitation) through `auth_consume_user_token`. */
@Injectable()
export class OneTimeTokenService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(CredentialsRepository) private readonly credentials: CredentialsRepository,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** The token works once, before it expires, and only for its own purpose. */
  async consume(type: UserTokenType, token: string, newPassword: string | undefined): Promise<ConsumedUserToken> {
    const tokenHash = sha256Hex(token);
    const stored = await this.runner.withAnonymousTransaction((tx) =>
      this.credentials.findUsableToken(tx, tokenHash, this.clock.now()),
    );
    if (stored?.type !== type) throw new InvalidTokenError();

    const passwordHash = newPassword === undefined ? null : await this.hasher.hash(newPassword);
    try {
      return await this.runner.withAnonymousTransaction((tx) => this.credentials.consumeToken(tx, tokenHash, passwordHash));
    } catch (error) {
      // Lost a race with another request that consumed it, or it expired meanwhile.
      if (mapDatabaseError(error) instanceof PermissionDeniedError) throw new InvalidTokenError({ cause: error });
      throw error;
    }
  }
}
