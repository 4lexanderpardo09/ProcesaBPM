import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateDelegationRequest,
  type DelegationResponse,
  type DelegationsQuery,
  extractSqlState,
  NotFoundError,
  OverlapError,
  type Page,
  PermissionDeniedError,
  ValidationFailedError,
} from '@procesabpm/shared';
import { compact } from '../../../common/crud/compact.js';
import { toPage } from '../../../common/crud/pagination.js';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { DelegationRepository, type DelegationRow } from '../data/delegation.repository.js';
import { cancellationOf } from '../domain/delegation-cancellation.js';

export interface DelegationActor {
  readonly userId: string;
  readonly ability: AppAbility;
}

const toResponse = (row: DelegationRow): DelegationResponse => ({
  ...row,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

const canManage = (actor: DelegationActor): boolean => actor.ability.can('manage', 'Delegation');

/**
 * Everybody manages their own delegations; `manage Delegation` extends that to anyone's. A person who
 * cannot manage only sees the delegations they give or receive, and another person's delegation is a
 * plain 404 for them. Overlaps (GiST exclusion) and circular delegations (trigger) answer 409.
 */
@Injectable()
export class DelegationsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(DelegationRepository) private readonly repository: DelegationRepository,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  list(actor: DelegationActor, query: DelegationsQuery): Promise<Page<DelegationResponse>> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { rows, total } = await this.repository.list(tx, this.tenantId, query, {
        now: this.clock.now(),
        ...(canManage(actor) ? {} : { involving: actor.userId }),
      });
      return toPage(rows, total, { ...query, includeInactive: true }, toResponse);
    });
  }

  create(actor: DelegationActor, request: CreateDelegationRequest): Promise<DelegationResponse> {
    const fromUserId = request.fromUserId ?? actor.userId;
    if (fromUserId !== actor.userId && !canManage(actor)) throw new PermissionDeniedError('Only an administrator creates delegations for someone else');
    if (fromUserId === request.toUserId) throw new ValidationFailedError([{ path: 'toUserId', message: 'Nobody delegates to themselves' }]);
    if (new Date(request.endsAt) <= this.clock.now()) throw new ValidationFailedError([{ path: 'endsAt', message: 'The delegation must end in the future' }]);
    return this.runner.withTenantTransaction(async (tx) => {
      try {
        const created = await this.repository.create(tx, this.tenantId, {
          fromUserId,
          toUserId: request.toUserId,
          startsAt: new Date(request.startsAt),
          endsAt: new Date(request.endsAt),
          ...compact({ reason: request.reason }),
        });
        return toResponse(created);
      } catch (error) {
        throw this.translateCircular(error);
      }
    });
  }

  cancel(actor: DelegationActor, id: string): Promise<DelegationResponse | undefined> {
    return this.runner.withTenantTransaction(async (tx) => {
      const delegation = await this.requireVisible(tx, actor, id);
      const now = this.clock.now();
      if (cancellationOf(delegation, now) === 'DELETE') {
        await this.repository.remove(tx, this.tenantId, id);
        return undefined;
      }
      await this.repository.endAt(tx, this.tenantId, id, now);
      return toResponse((await this.repository.findById(tx, this.tenantId, id))!);
    });
  }

  private async requireVisible(tx: TenantTransaction, actor: DelegationActor, id: string): Promise<DelegationRow> {
    const delegation = await this.repository.findById(tx, this.tenantId, id);
    if (delegation === null || (delegation.fromUserId !== actor.userId && !canManage(actor))) throw new NotFoundError();
    return delegation;
  }

  /** The circular-delegation trigger raises a check violation; to the client it is a conflict like an overlap. */
  private translateCircular(error: unknown): unknown {
    const text = error instanceof Error ? `${error.message} ${String((error.cause as Error | undefined)?.message ?? '')}` : '';
    return extractSqlState(error) === '23514' && text.includes('circular delegation') ? new OverlapError('A circular delegation in the same period', { cause: error }) : error;
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }
}
