import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  type CreateTextTemplateRequest,
  createTextTemplateRequestSchema,
  type SetTextTemplateSharesRequest,
  setTextTemplateSharesRequestSchema,
  type TextTemplateResponse,
  type UpdateTextTemplateRequest,
  updateTextTemplateRequestSchema,
} from '@procesabpm/shared';
import { AuthenticatedOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { TextTemplatesService } from '../application/text-templates.service.js';

/** Personal text templates: every member manages their own and may share them read-only. */
@AuthenticatedOnly()
@Controller('text-templates')
export class TextTemplatesController {
  constructor(@Inject(TextTemplatesService) private readonly templates: TextTemplatesService) {}

  @Get()
  list(): Promise<TextTemplateResponse[]> {
    return this.templates.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<TextTemplateResponse> {
    return this.templates.get(id);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createTextTemplateRequestSchema)) body: CreateTextTemplateRequest): Promise<TextTemplateResponse> {
    return this.templates.create(body);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateTextTemplateRequestSchema)) body: UpdateTextTemplateRequest): Promise<TextTemplateResponse> {
    return this.templates.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.templates.remove(id);
  }

  @Get(':id/shares')
  shares(@Param('id', ParseUUIDPipe) id: string): Promise<string[]> {
    return this.templates.shares(id);
  }

  @Put(':id/shares')
  setShares(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(setTextTemplateSharesRequestSchema)) body: SetTextTemplateSharesRequest): Promise<string[]> {
    return this.templates.setShares(id, body);
  }
}
