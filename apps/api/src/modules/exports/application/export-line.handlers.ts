import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { uuidSchema } from '@procesabpm/shared';
import { z } from 'zod';
import { Clock } from '../../../infrastructure/clock.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { ClaimedEvent } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { ExportDefinitionsRepository } from '../data/export-definitions.repository.js';
import { ExportSourcesRepository } from '../data/export-sources.repository.js';
import { ExportLineService } from './export-line.service.js';

const transitioned = z.object({ ticketId: uuidSchema, transitionId: uuidSchema.optional(), actorId: uuidSchema.nullable().optional() }).passthrough();
const closed = z.object({ ticketId: uuidSchema, closedById: uuidSchema.nullable().optional() }).passthrough();
const block = z.object({ ticketId: uuidSchema, stepId: uuidSchema }).passthrough();

const sameLabel = (left: string | null, right: string) => left !== null && left.trim().toLowerCase() === right.trim().toLowerCase();

/**
 * Writes the export lines a ticket's events ask for, in the transaction that completes the event: the definitions
 * whose transition (by label, the same across versions) the ticket took, the ones that wait for its closing, and the
 * one an EXPORT block names. Writing a line is idempotent, so an event delivered twice leaves one line.
 */
@Injectable()
export class ExportLineHandlers implements OnModuleInit {
  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(ExportDefinitionsRepository) private readonly definitions: ExportDefinitionsRepository,
    @Inject(ExportSourcesRepository) private readonly sources: ExportSourcesRepository,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(ExportLineService) private readonly lines: ExportLineService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.registry.registerTransactional({ type: 'ticket.transitioned', schema: transitioned, handle: (tx, event) => this.onTransitioned(tx, event) });
    this.registry.registerTransactional({ type: 'ticket.closed', schema: closed, handle: (tx, event) => this.onClosed(tx, event) });
    this.registry.registerTransactional({ type: 'block.export', schema: block, handle: (tx, event) => this.onBlock(tx, event) });
  }

  private async onTransitioned(tx: TenantTransaction, event: ClaimedEvent<z.infer<typeof transitioned>>): Promise<void> {
    const tenantId = event.tenantId!;
    const { ticketId, transitionId } = event.payload;
    if (transitionId === undefined) return;
    const ticket = await this.sources.ticket(tx, tenantId, ticketId);
    const label = await this.sources.transitionLabel(tx, tenantId, transitionId);
    if (ticket === undefined || label === undefined) return;
    const definitions = (await this.definitions.activeForWorkflow(tx, tenantId, ticket.workflowId, 'TRANSITION')).filter((definition) => sameLabel(definition.transitionLabel, label));
    await this.lines.project(tx, tenantId, ticketId, definitions, event.payload.actorId ?? null, this.clock.now());
  }

  private async onClosed(tx: TenantTransaction, event: ClaimedEvent<z.infer<typeof closed>>): Promise<void> {
    const tenantId = event.tenantId!;
    const ticket = await this.sources.ticket(tx, tenantId, event.payload.ticketId);
    if (ticket === undefined) return;
    const definitions = await this.definitions.activeForWorkflow(tx, tenantId, ticket.workflowId, 'CLOSING');
    await this.lines.project(tx, tenantId, ticket.id, definitions, event.payload.closedById ?? null, this.clock.now());
  }

  private async onBlock(tx: TenantTransaction, event: ClaimedEvent<z.infer<typeof block>>): Promise<void> {
    const tenantId = event.tenantId!;
    const ticket = await this.sources.ticket(tx, tenantId, event.payload.ticketId);
    if (ticket === undefined) return;
    const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
    const definitionId = document.steps.find((step) => step.id === event.payload.stepId)?.config.exportDefinitionId;
    if (typeof definitionId !== 'string') return;
    const definition = await this.definitions.find(tx, tenantId, definitionId);
    if (definition === undefined) return;
    await this.lines.project(tx, tenantId, ticket.id, [definition], null, this.clock.now());
  }
}
