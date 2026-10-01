import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type CloseTicketRequest,
  closeTicketRequestSchema,
  type CreateTicketRequest,
  type IncidentMutationResponse,
  type OpenIncidentRequest,
  openIncidentRequestSchema,
  type ResolveIncidentRequest,
  resolveIncidentRequestSchema,
  createTicketRequestSchema,
  type ListTicketsQuery,
  type ReopenTicketRequest,
  reopenTicketRequestSchema,
  listTicketsQuerySchema,
  type Page,
  type ReassignTicketRequest,
  reassignTicketRequestSchema,
  type TakeTicketRequest,
  takeTicketRequestSchema,
  type TicketDetailResponse,
  type TicketEventResponse,
  type TicketMutationResponse,
  type TicketSummaryResponse,
  type TransitionTicketRequest,
  transitionTicketRequestSchema,
} from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequireAnyPermission, RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { ReopenTicketService } from '../../engine/application/reopen-ticket.service.js';
import { OpenIncidentService } from '../../engine/application/open-incident.service.js';
import { ResolveIncidentService } from '../../engine/application/resolve-incident.service.js';
import { CloseTicketService } from '../../engine/application/close-ticket.service.js';
import { CreateTicketService } from '../../engine/application/create-ticket.service.js';
import { ReassignTicketService } from '../../engine/application/reassign-ticket.service.js';
import { TakeTicketService } from '../../engine/application/take-ticket.service.js';
import { TransitionTicketService } from '../../engine/application/transition-ticket.service.js';
import { ticketCreatorOf } from '../application/ticket-access.js';
import { TicketQueriesService } from '../application/ticket-queries.service.js';
import { TICKET_READ_ACTIONS, TICKET_SUBJECT } from '../domain/ticket-subject.js';

@Controller('tickets')
export class TicketsController {
  constructor(
    @Inject(TicketQueriesService) private readonly queries: TicketQueriesService,
    @Inject(CreateTicketService) private readonly creation: CreateTicketService,
    @Inject(TransitionTicketService) private readonly transitions: TransitionTicketService,
    @Inject(ReassignTicketService) private readonly reassignment: ReassignTicketService,
    @Inject(TakeTicketService) private readonly taking: TakeTicketService,
    @Inject(CloseTicketService) private readonly closing: CloseTicketService,
    @Inject(ReopenTicketService) private readonly reopening: ReopenTicketService,
    @Inject(OpenIncidentService) private readonly incidentOpening: OpenIncidentService,
    @Inject(ResolveIncidentService) private readonly incidentResolution: ResolveIncidentService,
  ) {}

  @RequireAnyPermission(['create', 'create_for_others'], TICKET_SUBJECT)
  @Post()
  create(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Body(new ZodValidationPipe(createTicketRequestSchema)) body: CreateTicketRequest): Promise<TicketMutationResponse> {
    return this.creation.create(ticketCreatorOf(principal, ability), body);
  }

  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Get()
  list(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Query(new ZodValidationPipe(listTicketsQuerySchema)) query: ListTicketsQuery): Promise<Page<TicketSummaryResponse>> {
    return this.queries.list(principal, ability, query);
  }

  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Get(':id')
  get(@CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string): Promise<TicketDetailResponse> {
    return this.queries.get(ability, id);
  }

  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Get(':id/timeline')
  timeline(@CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string): Promise<TicketEventResponse[]> {
    return this.queries.timeline(ability, id);
  }

  @RequirePermission('transition', TICKET_SUBJECT)
  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  transition(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(transitionTicketRequestSchema)) body: TransitionTicketRequest): Promise<TicketMutationResponse> {
    return this.transitions.transition(this.actor(principal, ability), id, body);
  }

  @RequirePermission('reassign', TICKET_SUBJECT)
  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  reassign(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reassignTicketRequestSchema)) body: ReassignTicketRequest): Promise<TicketMutationResponse> {
    return this.reassignment.reassign(this.actor(principal, ability), id, body);
  }

  @RequirePermission('transition', TICKET_SUBJECT)
  @Post(':id/take')
  @HttpCode(HttpStatus.OK)
  take(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(takeTicketRequestSchema)) body: TakeTicketRequest): Promise<TicketMutationResponse> {
    return this.taking.take(this.actor(principal, ability), id, body);
  }

  @RequirePermission('close', TICKET_SUBJECT)
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(closeTicketRequestSchema)) body: CloseTicketRequest): Promise<TicketMutationResponse> {
    return this.closing.close(this.actor(principal, ability), id, body);
  }

  @RequirePermission('open_incident', TICKET_SUBJECT)
  @Post(':id/incidents')
  openIncident(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(openIncidentRequestSchema)) body: OpenIncidentRequest): Promise<IncidentMutationResponse> {
    return this.incidentOpening.open(this.actor(principal, ability), id, body);
  }

  /** Being the person the incident is for is the authorization (checked against the record); the permission only gets you to the route. */
  @RequireAnyPermission(TICKET_READ_ACTIONS, TICKET_SUBJECT)
  @Post(':id/incidents/:incidentId/resolve')
  @HttpCode(HttpStatus.OK)
  resolveIncident(
    @CurrentPrincipal() principal: Principal,
    @CurrentAbility() ability: AppAbility,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('incidentId', ParseUUIDPipe) incidentId: string,
    @Body(new ZodValidationPipe(resolveIncidentRequestSchema)) body: ResolveIncidentRequest,
  ): Promise<TicketMutationResponse> {
    return this.incidentResolution.resolve(this.actor(principal, ability), id, incidentId, body);
  }

  @RequirePermission('reopen', TICKET_SUBJECT)
  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reopenTicketRequestSchema)) body: ReopenTicketRequest): Promise<TicketMutationResponse> {
    return this.reopening.reopen(this.actor(principal, ability), id, body);
  }

  private actor(principal: Principal, ability: AppAbility) {
    return this.queries.actorFor(principal, ability);
  }
}
