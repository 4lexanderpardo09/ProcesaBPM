import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type NamedRecordRequest,
  type NamedRecordResponse,
  namedRecordRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { DepartmentsService } from '../application/departments.service.js';

@Controller('departments')
export class DepartmentsController {
  constructor(@Inject(DepartmentsService) private readonly departments: DepartmentsService) {}

  @RequirePermission('read', 'Department')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<NamedRecordResponse>> {
    return this.departments.list(query);
  }

  @RequirePermission('read', 'Department')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<NamedRecordResponse> {
    return this.departments.get(id);
  }

  @RequirePermission('create', 'Department')
  @Post()
  create(@Body(new ZodValidationPipe(namedRecordRequestSchema)) body: NamedRecordRequest): Promise<NamedRecordResponse> {
    return this.departments.create(body);
  }

  @RequirePermission('update', 'Department')
  @Patch(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(namedRecordRequestSchema)) body: NamedRecordRequest): Promise<NamedRecordResponse> {
    return this.departments.rename(id, body);
  }

  @RequirePermission('update', 'Department')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<NamedRecordResponse> {
    return this.departments.activate(id);
  }

  @RequirePermission('delete', 'Department')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<NamedRecordResponse> {
    return this.departments.deactivate(id);
  }
}
