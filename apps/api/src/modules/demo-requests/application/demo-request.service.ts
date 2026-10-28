import { Inject, Injectable } from '@nestjs/common';
import type { DemoRequest } from '@procesabpm/shared';
import { AuthTransactionRunner } from '../../../infrastructure/database/auth-transaction-runner.js';
import { DemoRequestRepository } from '../data/demo-request.repository.js';
import { isLikelyBot } from '../domain/demo-request-policy.js';

@Injectable()
export class DemoRequestService {
  constructor(
    @Inject(AuthTransactionRunner) private readonly runner: AuthTransactionRunner,
    @Inject(DemoRequestRepository) private readonly requests: DemoRequestRepository,
  ) {}

  /**
   * The answer is the same whether the request was stored, was a repeat of today's or came from a bot: the form only
   * learns that it was received, never whether an address had written before.
   */
  async submit(request: DemoRequest): Promise<void> {
    if (isLikelyBot(request.website)) return;
    await this.runner.withAnonymousTransaction((tx) => this.requests.submit(tx, request));
  }
}
