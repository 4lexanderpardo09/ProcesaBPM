import { Injectable } from '@nestjs/common';
import { type DemoRequest, DEMO_PRIVACY_NOTICE_VERSION, hasSqlState, RateLimitedError } from '@procesabpm/shared';
import type { AuthTransaction } from '../../../infrastructure/database/auth-transaction-runner.js';

/** What `submit_demo_request` raises when the website sent more than its hourly cap, from every address together. */
const TOO_MANY_REQUESTS = '54000';
/** The hourly cap is a rolling hour: asking again a few minutes later is a fair answer. */
export const DEMO_REQUEST_CAP_RETRY_AFTER_SECONDS = 15 * 60;

/** The API's only door to the demo requests (the table is platform-only, docs/base-de-datos.md §8.33). */
@Injectable()
export class DemoRequestRepository {
  /** Stores the request and queues the e-mail to the sales inbox, or returns the one this address sent in the last day. */
  async submit(tx: AuthTransaction, request: DemoRequest): Promise<void> {
    try {
      await tx.$queryRaw`
        SELECT submit_demo_request(${request.fullName}, ${request.company}, ${request.email}, ${request.teamSize}::demo_team_size,
          ${request.process ?? null}, ${DEMO_PRIVACY_NOTICE_VERSION}::smallint)`;
    } catch (error) {
      if (hasSqlState(error, TOO_MANY_REQUESTS)) throw new RateLimitedError(DEMO_REQUEST_CAP_RETRY_AFTER_SECONDS);
      throw error;
    }
  }
}
