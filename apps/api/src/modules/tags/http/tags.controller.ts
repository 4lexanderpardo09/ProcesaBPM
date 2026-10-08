import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { type CreateTagRequest, createTagRequestSchema, type TagResponse, type UpdateTagRequest, updateTagRequestSchema } from '@procesabpm/shared';
import { AuthenticatedOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { TagsService } from '../application/tags.service.js';

/** Personal tags: every member manages their own, so no permission beyond being signed in is needed. */
@AuthenticatedOnly()
@Controller('tags')
export class TagsController {
  constructor(@Inject(TagsService) private readonly tags: TagsService) {}

  @Get()
  list(): Promise<TagResponse[]> {
    return this.tags.list();
  }

  @Post()
  create(@Body(new ZodValidationPipe(createTagRequestSchema)) body: CreateTagRequest): Promise<TagResponse> {
    return this.tags.create(body);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateTagRequestSchema)) body: UpdateTagRequest): Promise<TagResponse> {
    return this.tags.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tags.remove(id);
  }
}
