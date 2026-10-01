import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { ArrivalPlanner } from './application/arrival-planner.js';
import { AssignmentResolver } from './application/assignment-resolver.js';
import { CloseTicketService } from './application/close-ticket.service.js';
import { CreateTicketService } from './application/create-ticket.service.js';
import { DispatchStepService } from './application/dispatch-step.service.js';
import { ParallelTaskService } from './application/parallel-task.service.js';
import { ReopenTicketService } from './application/reopen-ticket.service.js';
import { OpenIncidentService } from './application/open-incident.service.js';
import { ResolveIncidentService } from './application/resolve-incident.service.js';
import { LockedTicketLoader } from './application/locked-ticket.js';
import { ReassignTicketService } from './application/reassign-ticket.service.js';
import { SubmissionValidator } from './application/submission-validator.js';
import { TakeTicketService } from './application/take-ticket.service.js';
import { TicketMutationApplier } from './application/ticket-mutation-applier.js';
import { TicketSlaService } from './application/ticket-sla.service.js';
import { TransitionTicketService } from './application/transition-ticket.service.js';
import { AssignmentCandidatesRepository } from './data/assignment-candidates.repository.js';
import { FieldReferenceRepository } from './data/field-reference.repository.js';
import { TicketContextRepository } from './data/ticket-context.repository.js';
import { DispatchRepository } from './data/dispatch.repository.js';
import { TicketWriteRepository } from './data/ticket-write.repository.js';

/** The ticket engine: starts tickets, moves them along their workflow, resolves who is assigned and keeps their SLA clocks. */
@Module({
  imports: [WorkflowsModule, ApprovalsModule],
  providers: [
    TicketWriteRepository,
    DispatchRepository,
    TicketContextRepository,
    AssignmentCandidatesRepository,
    FieldReferenceRepository,
    AssignmentResolver,
    SubmissionValidator,
    ArrivalPlanner,
    LockedTicketLoader,
    TicketSlaService,
    TicketMutationApplier,
    CreateTicketService,
    TransitionTicketService,
    ReassignTicketService,
    TakeTicketService,
    CloseTicketService,
    OpenIncidentService,
    ResolveIncidentService,
    ReopenTicketService,
    ParallelTaskService,
    DispatchStepService,
  ],
  exports: [CreateTicketService, TransitionTicketService, ReassignTicketService, TakeTicketService, CloseTicketService, OpenIncidentService, ResolveIncidentService, ReopenTicketService, ParallelTaskService, DispatchStepService, DispatchRepository],
})
export class EngineModule {}
