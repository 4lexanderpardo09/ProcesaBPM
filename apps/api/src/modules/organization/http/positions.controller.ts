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
import { PositionsService } from '../application/positions.service.js';

@Controller('positions')
export class PositionsController {
  constructor(@Inject(PositionsService) private readonly positions: PositionsService) {}

  @RequirePermission('read', 'Position')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<NamedRecordResponse>> {
    return this.positions.list(query);
  }

  @RequirePermission('read', 'Position')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<NamedRecordResponse> {
    return this.positions.get(id);
  }

  @RequirePermission('create', 'Position')
  @Post()
  create(@Body(new ZodValidationPipe(namedRecordRequestSchema)) body: NamedRecordRequest): Promise<NamedRecordResponse> {
    return this.positions.create(body);
  }

  @RequirePermission('update', 'Position')
  @Patch(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(namedRecordRequestSchema)) body: NamedRecordRequest): Promise<NamedRecordResponse> {
    return this.positions.rename(id, body);
  }

  @RequirePermission('update', 'Position')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<NamedRecordResponse> {
    return this.positions.activate(id);
  }

  @RequirePermission('delete', 'Position')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<NamedRecordResponse> {
    return this.positions.deactivate(id);
  }
}
