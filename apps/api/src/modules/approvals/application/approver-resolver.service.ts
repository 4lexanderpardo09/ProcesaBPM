import { Inject, Injectable } from '@nestjs/common';
import {
  type ApproverOutcome,
  type ApproverResolution,
  ApproverNotFoundError,
  InvalidStateError,
  MAX_APPROVAL_LEVEL,
  NotFoundError,
  type ResolveApproverQuery,
} from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { ApproverSnapshotRepository } from '../data/approver-snapshot.repository.js';
import { resolveApprover } from '../domain/resolve-approver.js';

export interface ApproverRequest {
  readonly creatorId: string;
  readonly companyId: string;
  readonly typeId: string;
  readonly level: number;
  /** The instant the delegations are checked at (the engine passes the time of the transition). */
  readonly at: Date;
}

/** Who approves a ticket: the approval group of the creator for the type, with delegations and levels. */
@Injectable()
export class ApproverResolver {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(ApproverSnapshotRepository) private readonly snapshots: ApproverSnapshotRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Inside the caller's transaction (the engine resolves while it moves a ticket). Throws `ApproverNotFoundError`. */
  async resolveIn(tx: TenantTransaction, request: ApproverRequest): Promise<ApproverResolution> {
    const outcome = await this.outcomeIn(tx, request);
    if (!outcome.found) throw new ApproverNotFoundError(outcome);
    return outcome;
  }

  /** The diagnostic: always an outcome, with the trace of the search whether it found someone or not. */
  diagnose(query: ResolveApproverQuery): Promise<ApproverOutcome> {
    return this.runner.withTenantTransaction(async (tx) => {
      const tenantId = this.context.require().tenantId;
      const exists = await this.snapshots.existence(tx, tenantId, query);
      if (!exists.user || !exists.type || !exists.company) throw new NotFoundError();
      return this.outcomeIn(tx, { creatorId: query.userId, companyId: query.companyId, typeId: query.typeId, level: query.level, at: query.at === undefined ? this.clock.now() : new Date(query.at) });
    });
  }

  private async outcomeIn(tx: TenantTransaction, request: ApproverRequest): Promise<ApproverOutcome> {
    if (!Number.isInteger(request.level) || request.level < 1 || request.level > MAX_APPROVAL_LEVEL) {
      throw new InvalidStateError(`The approval level must be between 1 and ${MAX_APPROVAL_LEVEL}`);
    }
    const snapshot = await this.snapshots.load(tx, this.context.require().tenantId, request);
    return resolveApprover(snapshot, request.creatorId, request.level);
  }
}
