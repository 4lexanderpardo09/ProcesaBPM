import { Inject, Injectable } from '@nestjs/common';
import { AmountLimitExceededError, correctableFields, type EditTicketRequest, type EditTicketResponse, evaluateAmountRules, type FieldDocument, FieldValuesInvalidError, InvalidReferenceError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { type TenantTransaction, TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { type LockedTicket, type TicketHeader, TicketWriteRepository } from '../data/ticket-write.repository.js';
import { editRefusal } from '../domain/ticket-action-rules.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
import { type Submission, SubmissionValidator } from './submission-validator.js';

type HeaderChange = { readonly [K in keyof TicketHeader]: { readonly code: K; readonly before: TicketHeader[K]; readonly after: TicketHeader[K] } }[keyof TicketHeader];

/**
 * Corrects what a ticket says (its subject, description, priority or the values recorded so far) without moving it: a
 * supervisor fixing a badly titled request, raising its priority or correcting a mistyped amount. It needs the `update`
 * permission on this very ticket and an open or paused ticket; the values are validated like an answer (formulas
 * recomputed, amount caps checked) and the previous ones stay in the timeline (`FIELDS_UPDATED`, source `EDIT`).
 */
@Injectable()
export class EditTicketService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(SubmissionValidator) private readonly submissions: SubmissionValidator,
  ) {}

  edit(actor: TicketActor, ticketId: string, request: EditTicketRequest): Promise<EditTicketResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const { ticket } = await this.loader.lockForAction(tx, tenantId, ticketId, actor);
      const refusal = editRefusal(await actor.can(tx, ticket.id, 'update'), ticket.status);
      if (refusal !== null) throw refusal;
      if (request.priorityId != null && !(await this.writes.isActivePriority(tx, tenantId, request.priorityId))) throw new InvalidReferenceError('Unknown or inactive priority');

      const at = this.clock.now();
      const corrected = request.values === undefined || Object.keys(request.values).length === 0 ? undefined : await this.correctValues(tx, tenantId, ticket, actor.userId, request.values, at);
      const before = await this.writes.findTicketHeader(tx, tenantId, ticket.id);
      const after: TicketHeader = {
        title: request.title ?? before.title,
        descriptionHtml: request.description === undefined ? before.descriptionHtml : sanitizeRichText(request.description),
        priorityId: request.priorityId === undefined ? before.priorityId : request.priorityId,
      };
      const header = headerChanges(before, after);
      const changes = [...header, ...(corrected?.changes ?? [])];
      if (changes.length === 0) return { eventId: null };

      if (header.length > 0) await this.writes.updateTicketHeader(tx, tenantId, ticket.id, Object.fromEntries(header.map((change) => [change.code, change.after])));
      if (corrected !== undefined && corrected.fieldWrites.length > 0) await this.writes.upsertFieldValues(tx, tenantId, ticket.id, ticket.workflowVersionId, actor.userId, corrected.fieldWrites);
      const eventId = await this.writes.insertEvent(tx, tenantId, ticket.id, at, {
        type: 'FIELDS_UPDATED',
        stepId: ticket.currentStepId,
        loop: ticket.currentLoop,
        actorId: actor.userId,
        data: { changes, source: 'EDIT' },
      });
      return { eventId };
    });
  }

  /**
   * The recorded values as corrected: only `correctableFields`, validated like an answer on the step the ticket is on,
   * and held to the amount caps of that step and of the steps where the corrected fields were captured.
   */
  private async correctValues(tx: TenantTransaction, tenantId: string, ticket: LockedTicket, actorId: string, input: Readonly<Record<string, unknown>>, at: Date): Promise<Submission> {
    const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
    const existing = await this.loader.valuesOf(tx, tenantId, ticket.id, document);
    const correctable = new Map(correctableFields(document.fields, existing).map((field) => [field.code, field]));
    const refused = Object.keys(input).filter((code) => !correctable.has(code));
    if (refused.length > 0) throw new FieldValuesInvalidError(refused.map((code) => ({ code: 'NOT_EDITABLE', fieldCode: code })));
    const step = document.steps.find((candidate) => candidate.id === ticket.currentStepId) ?? document.steps.find((candidate) => candidate.type === 'START')!;
    const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
    const member = await this.people.findActiveMember(tx, tenantId, actorId);
    const positionId = member?.positionId ?? null;
    const fields = Object.keys(input).map((code) => correctable.get(code)!);
    const submission = await this.submissions.validate(tx, { tenantId, document, stage: 'STEP', step, fields, input, existing, company, positionId, at, uploaderId: actorId, attachmentIds: [] });
    const fieldByCode = new Map<string, FieldDocument>(document.fields.map((field) => [field.code, field]));
    for (const stepId of new Set(fields.map((field) => field.stepId))) {
      const amounts = evaluateAmountRules(document.amountRules, fieldByCode, submission.merged, { stepId, companyId: company.id, positionId, companyCurrency: company.currencyCode });
      if (amounts.blocks.length > 0) throw new AmountLimitExceededError(amounts.blocks);
    }
    return submission;
  }
}

function headerChanges(before: TicketHeader, after: TicketHeader): HeaderChange[] {
  const changes: HeaderChange[] = [];
  if (before.title !== after.title) changes.push({ code: 'title', before: before.title, after: after.title });
  if (before.descriptionHtml !== after.descriptionHtml) changes.push({ code: 'descriptionHtml', before: before.descriptionHtml, after: after.descriptionHtml });
  if (before.priorityId !== after.priorityId) changes.push({ code: 'priorityId', before: before.priorityId, after: after.priorityId });
  return changes;
}
