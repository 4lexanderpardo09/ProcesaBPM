import { Inject, Injectable } from '@nestjs/common';
import { WorkerTransactionRunner } from '../../../infrastructure/database/worker-transaction-runner.js';
import { LoginTokenRepository } from '../data/login-token.repository.js';

/** Forgets the ids of used login tokens once they cannot be presented any more (they only matter until they expire). */
@Injectable()
export class AuthTokenPurgeJob {
  constructor(
    @Inject(WorkerTransactionRunner) private readonly runner: WorkerTransactionRunner,
    @Inject(LoginTokenRepository) private readonly loginTokens: LoginTokenRepository,
  ) {}

  runOnce(): Promise<number> {
    return this.runner.withoutTenant((tx) => this.loginTokens.purgeExpired(tx));
  }
}
