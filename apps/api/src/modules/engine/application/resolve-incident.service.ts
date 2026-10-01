import { Inject, Injectable } from '@nestjs/common';
import { IncidentNotOpenError, InvalidAssigneeError, InvalidStateError, NotFoundError, PermissionDeniedError, type ResolveIncidentRequest, type TicketMutationResponse, ValidationFailedError } from '@procesabpm/shared';
import { Clock } from '../../../infrastructure/clock.js';
import { TenantContext } from '../../../infrastructure/database/tenant-context.js';
import { TenantTransactionRunner } from '../../../infrastructure/database/tenant-transaction-runner.js';
import { sanitizeRichText } from '../../../infrastructure/text/rich-text.js';
import { openSla } from '../../sla/domain/clock-math.js';
import { pausePeriodsOf, resumeSla } from '../../sla/domain/pause-math.js';
import { PublishedVersionReader } from '../../workflows/application/published-version-reader.js';
import { AssignmentCandidatesRepository } from '../data/assignment-candidates.repository.js';
import { TicketContextRepository } from '../data/ticket-context.repository.js';
import { TicketWriteRepository } from '../data/ticket-write.repository.js';
import { mayResolveIncident, restorePlan } from '../domain/incident-policy.js';
import type { EventPlan, VisitPlan } from '../domain/plan.js';
import { LockedTicketLoader, type TicketActor } from './locked-ticket.js';
import { TicketSlaService } from './ticket-sla.service.js';

/**
 * Resolves an incident: the paused clocks run again with their due dates moved by the business minutes they
 * stood still (company calendar), and the ticket goes back to the people who held the step, or to the one the
 * caller names. Everything is computed before the first write.
 */
@Injectable()
export class ResolveIncidentService {
  constructor(
    @Inject(TenantTransactionRunner) private readonly runner: TenantTransactionRunner,
    @Inject(TenantContext) private readonly context: TenantContext,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LockedTicketLoader) private readonly loader: LockedTicketLoader,
    @Inject(PublishedVersionReader) private readonly versions: PublishedVersionReader,
    @Inject(TicketContextRepository) private readonly people: TicketContextRepository,
    @Inject(AssignmentCandidatesRepository) private readonly candidates: AssignmentCandidatesRepository,
    @Inject(TicketWriteRepository) private readonly writes: TicketWriteRepository,
    @Inject(TicketSlaService) private readonly sla: TicketSlaService,
  ) {}

  resolve(actor: TicketActor, ticketId: string, incidentId: string, request: ResolveIncidentRequest): Promise<TicketMutationResponse> {
    return this.runner.withTenantTransaction(async (tx) => {
      const { tenantId } = this.context.require();
      const at = this.clock.now();
      const { ticket } = await this.loader.lockForAction(tx, tenantId, ticketId, actor);
      const incident = await this.writes.findIncident(tx, tenantId, ticket.id, incidentId);
      if (incident === null) throw new NotFoundError();
      if (incident.status !== 'OPEN') throw new IncidentNotOpenError();
      const visit = await this.writes.findOpenVisit(tx, tenantId, ticket.id);
      if (ticket.status !== 'PAUSED' || visit === null) throw new InvalidStateError('The ticket is not paused by this incident');

      const canReassign = await actor.can(tx, ticket.id, 'reassign');
      const allowed = mayResolveIncident({ actorId: actor.userId, incident, canOpenIncident: await actor.can(tx, ticket.id, 'open_incident'), canReassign });
      if (!allowed || (request.assigneeId !== undefined && !canReassign)) throw new PermissionDeniedError('Not allowed to resolve this incident');
      const resolution = sanitizeRichText(request.resolution);
      if (resolution === '') throw new ValidationFailedError([{ path: 'resolution', message: 'The resolution is empty' }]);

      const company = (await this.people.findCompany(tx, tenantId, ticket.companyId, false))!;
      const named = request.assigneeId === undefined ? null : await this.people.findActiveMember(tx, tenantId, request.assigneeId);
      if (request.assigneeId !== undefined && (named === null || !named.companyIds.includes(ticket.companyId))) throw new InvalidAssigneeError();

      const clocks = await this.writes.findOpenClocks(tx, tenantId, visit.id);
      const document = await this.versions.documentOf(tx, tenantId, ticket.workflowVersionId);
      const step = document.steps.find((candidate) => candidate.id === visit.stepId);
      if (step === undefined) throw new InvalidStateError('The ticket is not on a step of its version');
      // Signatures move with `reassign` + `fromUserId`, not by naming a holder: that would leave the tasks pending and nobody signing.
      if (step.assignmentMode === 'PARALLEL' && request.assigneeId !== undefined) throw new InvalidAssigneeError();
      const active = new Set((await this.candidates.byUsers(tx, tenantId, incident.previousAssigneeIds)).map((row) => row.userId));
      const plan = restorePlan({
        previousAssigneeIds: incident.previousAssigneeIds,
        activeIds: active,
        pendingSignerIds: await this.writes.pendingSignerIds(tx, tenantId, ticket.id, visit.stepId, visit.loop),
        poolClockOpen: clocks.some((clock) => clock.responsibleId === null),
        mode: step.assignmentMode,
        explicitAssigneeId: request.assigneeId,
      });

      const calendar = (await this.people.findBusinessCalendar(tx, tenantId, company.timeZone, visit.calendarId, visit.enteredAt))?.calendar ?? null;
      const pauses = pausePeriodsOf(await this.writes.findIncidentPeriods(tx, tenantId, ticket.id), at);
      const resumedClock = (clock: (typeof clocks)[number]) =>
        resumeSla({ startedAt: clock.startedAt, terms: { value: clock.slaValue, unit: clock.slaUnit }, calendar, pauses, pausedAt: clock.pausedAt ?? incident.openedAt, resumedAt: at, pausedMinutes: clock.pausedMinutes });
      const resumedVisit = resumeSla({ startedAt: visit.enteredAt, terms: { value: visit.slaValue, unit: visit.slaUnit }, calendar, pauses, pausedAt: incident.openedAt, resumedAt: at, pausedMinutes: visit.pausedMinutes });
      const pausedBusinessMinutes = resumedVisit.pausedMinutes - visit.pausedMinutes;

      // A dispatched ticket whose holder is gone goes back to the queue (its clock loses the responsible but keeps running);
      // otherwise the dropped people's clocks end, and all of them do when the ticket goes to a named person (as a reassignment does).
      const backToQueue = step.assignmentMode === 'RANDOM_DISPATCH' && request.assigneeId === undefined && plan.restore.length === 0;
      const dropped = clocks.filter((clock) => clock.responsibleId !== null && plan.dropped.includes(clock.responsibleId));
      const ending = backToQueue ? [] : request.assigneeId === undefined ? dropped : clocks;
      const endingIds = new Set(ending.map((clock) => clock.id));
      // Every clock runs again first, with its due date moved by the pause: the ones that end here are judged against that date, not the stale one.
      for (const clock of clocks) await this.writes.resumeClock(tx, tenantId, clock.id, resumedClock(clock));
      const resumedEnding = ending.map((clock) => ({ ...clock, ...resumedClock(clock), pausedAt: null }));
      await this.writes.closeClocks(tx, tenantId, at, await this.sla.closeClocks(tx, tenantId, ticket.id, company, visit, resumedEnding, at));
      if (backToQueue) for (const clock of dropped) await this.writes.releaseClock(tx, tenantId, clock.id);
      await this.writes.updateVisitPause(tx, tenantId, visit.id, resumedVisit);
      await this.writes.deleteAssignees(tx, tenantId, ticket.id);
      const events: EventPlan[] = [];
      if (named !== null) {
        const opened = openSla({ value: visit.slaValue, unit: visit.slaUnit }, calendar, at);
        const visitPlan: VisitPlan = { stepId: visit.stepId, loop: visit.loop, enteredAt: visit.enteredAt, sla: { value: visit.slaValue, unit: visit.slaUnit }, calendarId: visit.calendarId, dueAt: resumedVisit.dueAt };
        await this.writes.insertAssignees(tx, tenantId, ticket.id, at, [{ userId: named.userId, type: 'PRIMARY' }]);
        await this.writes.insertClocks(tx, tenantId, ticket, visit.id, visitPlan, [{ responsibleId: named.userId, startedAt: at, sla: { value: opened.value, unit: opened.unit }, calendarId: visit.calendarId, dueAt: opened.dueAt }]);
        events.push({ type: 'ASSIGNED', stepId: visit.stepId, loop: visit.loop, actorId: actor.userId, assigneeId: named.userId, data: { assigneeType: 'PRIMARY' }, outbox: [{ type: 'ticket.assigned', payload: { stepId: visit.stepId, loop: visit.loop, userId: named.userId, assigneeType: 'PRIMARY' } }] });
      } else if (plan.restore.length > 0) {
        await this.writes.insertAssignees(tx, tenantId, ticket.id, at, plan.restore);
      }
      await this.writes.resolveIncident(tx, tenantId, incident.id, at, resolution);
      await this.writes.setTicketStatus(tx, tenantId, ticket.id, 'OPEN');
      const resolvedEvent: EventPlan = {
        type: 'INCIDENT_RESOLVED',
        stepId: visit.stepId,
        loop: visit.loop,
        actorId: actor.userId,
        commentHtml: resolution,
        data: { incidentId: incident.id, pausedBusinessMinutes, restoredAssigneeIds: plan.restore.map((entry) => entry.userId), droppedAssigneeIds: plan.dropped },
        outbox: [{ type: 'ticket.incident_resolved', payload: { incidentId: incident.id } }],
      };
      for (const event of [resolvedEvent, ...events]) await this.writes.insertEvent(tx, tenantId, ticket.id, at, event);
      return { id: ticket.id, number: ticket.number.toString(), status: 'OPEN', currentStepId: visit.stepId, openVisitId: visit.id };
    });
  }
}
