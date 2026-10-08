import { Inject, Injectable } from '@nestjs/common';
import { type AttachTagRequest, NotFoundError, type TagResponse } from '@procesabpm/shared';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { accessibleWhere } from '../../authorization/domain/record-access.js';
import { TicketQueryRepository } from '../../tickets/data/ticket-query.repository.js';
import { TICKET_READ_ACTIONS, TICKET_SUBJECT } from '../../tickets/domain/ticket-subject.js';
import { TagRepository, type TagRow } from '../data/tag.repository.js';

const toResponse = (row: TagRow): TagResponse => ({ id: row.id, name: row.name, color: row.color });

/**
 * Tags on a ticket: personal. The caller must be able to read the ticket (checked against the record, not the
 * type), and only their own tags can be attached or detached. A ticket they cannot read answers 404.
 */
@Injectable()
export class TicketTagsService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(TagRepository) private readonly tags: TagRepository,
    @Inject(TicketQueryRepository) private readonly tickets: TicketQueryRepository,
  ) {}

  list(ability: AppAbility, ticketId: string): Promise<TagResponse[]> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireReadable(tx, ability, ticketId);
      return (await this.tags.listForTicket(tx, this.tenantId, ticketId, this.userId)).map(toResponse);
    });
  }

  attach(ability: AppAbility, ticketId: string, request: AttachTagRequest): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireReadable(tx, ability, ticketId);
      // Only the caller's own tags: the composite foreign key (tenant, tag, user) would reject anything else.
      if ((await this.tags.findOwn(tx, this.tenantId, this.userId, request.tagId)) === null) throw new NotFoundError();
      await this.tags.attach(tx, this.tenantId, ticketId, request.tagId, this.userId);
    });
  }

  detach(ability: AppAbility, ticketId: string, tagId: string): Promise<void> {
    return this.runner.withTenantTransaction(async (tx) => {
      await this.requireReadable(tx, ability, ticketId);
      if ((await this.tags.findOwn(tx, this.tenantId, this.userId, tagId)) === null) throw new NotFoundError();
      await this.tags.detach(tx, this.tenantId, ticketId, tagId, this.userId);
    });
  }

  private async requireReadable(tx: TenantTransaction, ability: AppAbility, ticketId: string): Promise<void> {
    const access = accessibleWhere(ability, TICKET_READ_ACTIONS, TICKET_SUBJECT);
    if (!(await this.tickets.isAccessible(tx, this.tenantId, ticketId, access))) throw new NotFoundError();
  }

  private get tenantId(): string {
    return this.context.require().tenantId;
  }

  private get userId(): string {
    return this.context.require().userId;
  }
}
