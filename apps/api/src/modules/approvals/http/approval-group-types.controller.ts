import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type ApprovalGroupTypeRequest,
  type ApprovalGroupTypeResponse,
  approvalGroupTypeRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { ApprovalGroupTypesService } from '../application/approval-group-types.service.js';

@Controller('approval-group-types')
export class ApprovalGroupTypesController {
  constructor(@Inject(ApprovalGroupTypesService) private readonly types: ApprovalGroupTypesService) {}

  @RequirePermission('read', 'ApprovalGroup')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<ApprovalGroupTypeResponse>> {
    return this.types.list(query);
  }

  @RequirePermission('read', 'ApprovalGroup')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ApprovalGroupTypeResponse> {
    return this.types.get(id);
  }

  @RequirePermission('create', 'ApprovalGroup')
  @Post()
  create(@Body(new ZodValidationPipe(approvalGroupTypeRequestSchema)) body: ApprovalGroupTypeRequest): Promise<ApprovalGroupTypeResponse> {
    return this.types.create(body);
  }

  @RequirePermission('update', 'ApprovalGroup')
  @Patch(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(approvalGroupTypeRequestSchema)) body: ApprovalGroupTypeRequest): Promise<ApprovalGroupTypeResponse> {
    return this.types.rename(id, body);
  }

  @RequirePermission('delete', 'ApprovalGroup')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.types.remove(id);
  }
}
