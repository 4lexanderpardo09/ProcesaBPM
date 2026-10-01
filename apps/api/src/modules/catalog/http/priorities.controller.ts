import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CreatePriorityRequest,
  createPriorityRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type PriorityResponse,
  type UpdatePriorityRequest,
  updatePriorityRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { PrioritiesService } from '../application/priorities.service.js';

@Controller('priorities')
export class PrioritiesController {
  constructor(@Inject(PrioritiesService) private readonly priorities: PrioritiesService) {}

  @RequirePermission('read', 'Priority')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<PriorityResponse>> {
    return this.priorities.list(query);
  }

  @RequirePermission('read', 'Priority')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PriorityResponse> {
    return this.priorities.get(id);
  }

  @RequirePermission('create', 'Priority')
  @Post()
  create(@Body(new ZodValidationPipe(createPriorityRequestSchema)) body: CreatePriorityRequest): Promise<PriorityResponse> {
    return this.priorities.create(body);
  }

  @RequirePermission('update', 'Priority')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updatePriorityRequestSchema)) body: UpdatePriorityRequest): Promise<PriorityResponse> {
    return this.priorities.update(id, body);
  }

  @RequirePermission('update', 'Priority')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<PriorityResponse> {
    return this.priorities.activate(id);
  }

  @RequirePermission('delete', 'Priority')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<PriorityResponse> {
    return this.priorities.deactivate(id);
  }
}
