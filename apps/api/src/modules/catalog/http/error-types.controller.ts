import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateErrorSubtypeRequest,
  createErrorSubtypeRequestSchema,
  type CreateErrorTypeRequest,
  createErrorTypeRequestSchema,
  type ErrorSubtypeResponse,
  type ErrorTypeResponse,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type UpdateErrorSubtypeRequest,
  updateErrorSubtypeRequestSchema,
  type UpdateErrorTypeRequest,
  updateErrorTypeRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { ErrorTypesService } from '../application/error-types.service.js';

const uuid = new ParseUUIDPipe();

@Controller('error-types')
export class ErrorTypesController {
  constructor(@Inject(ErrorTypesService) private readonly errorTypes: ErrorTypesService) {}

  @RequirePermission('read', 'ErrorType')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<ErrorTypeResponse>> {
    return this.errorTypes.list(query);
  }

  @RequirePermission('read', 'ErrorType')
  @Get(':id')
  get(@Param('id', uuid) id: string): Promise<ErrorTypeResponse> {
    return this.errorTypes.get(id);
  }

  @RequirePermission('create', 'ErrorType')
  @Post()
  create(@Body(new ZodValidationPipe(createErrorTypeRequestSchema)) body: CreateErrorTypeRequest): Promise<ErrorTypeResponse> {
    return this.errorTypes.create(body);
  }

  @RequirePermission('update', 'ErrorType')
  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateErrorTypeRequestSchema)) body: UpdateErrorTypeRequest): Promise<ErrorTypeResponse> {
    return this.errorTypes.update(id, body);
  }

  @RequirePermission('update', 'ErrorType')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', uuid) id: string): Promise<ErrorTypeResponse> {
    return this.errorTypes.activate(id);
  }

  @RequirePermission('delete', 'ErrorType')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', uuid) id: string): Promise<ErrorTypeResponse> {
    return this.errorTypes.deactivate(id);
  }

  @RequirePermission('read', 'ErrorType')
  @Get(':typeId/subtypes')
  listSubtypes(@Param('typeId', uuid) typeId: string, @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<ErrorSubtypeResponse>> {
    return this.errorTypes.listSubtypes(typeId, query);
  }

  @RequirePermission('read', 'ErrorType')
  @Get(':typeId/subtypes/:id')
  getSubtype(@Param('typeId', uuid) typeId: string, @Param('id', uuid) id: string): Promise<ErrorSubtypeResponse> {
    return this.errorTypes.getSubtype(typeId, id);
  }

  @RequirePermission('create', 'ErrorType')
  @Post(':typeId/subtypes')
  createSubtype(@Param('typeId', uuid) typeId: string, @Body(new ZodValidationPipe(createErrorSubtypeRequestSchema)) body: CreateErrorSubtypeRequest): Promise<ErrorSubtypeResponse> {
    return this.errorTypes.createSubtype(typeId, body);
  }

  @RequirePermission('update', 'ErrorType')
  @Patch(':typeId/subtypes/:id')
  updateSubtype(@Param('typeId', uuid) typeId: string, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(updateErrorSubtypeRequestSchema)) body: UpdateErrorSubtypeRequest): Promise<ErrorSubtypeResponse> {
    return this.errorTypes.updateSubtype(typeId, id, body);
  }

  @RequirePermission('update', 'ErrorType')
  @Post(':typeId/subtypes/:id/activate')
  @HttpCode(HttpStatus.OK)
  activateSubtype(@Param('typeId', uuid) typeId: string, @Param('id', uuid) id: string): Promise<ErrorSubtypeResponse> {
    return this.errorTypes.activateSubtype(typeId, id);
  }

  @RequirePermission('delete', 'ErrorType')
  @Post(':typeId/subtypes/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivateSubtype(@Param('typeId', uuid) typeId: string, @Param('id', uuid) id: string): Promise<ErrorSubtypeResponse> {
    return this.errorTypes.deactivateSubtype(typeId, id);
  }
}
