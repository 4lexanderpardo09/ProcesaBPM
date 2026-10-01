import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type CategoryRequest,
  type CategoryResponse,
  type CategoryVisibilityResponse,
  categoryRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type ReplaceCategoryVisibilityRequest,
  replaceCategoryVisibilitySchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { CategoriesService } from '../application/categories.service.js';

@Controller('categories')
export class CategoriesController {
  constructor(@Inject(CategoriesService) private readonly categories: CategoriesService) {}

  @RequirePermission('read', 'Category')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<CategoryResponse>> {
    return this.categories.list(query);
  }

  @RequirePermission('read', 'Category')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryResponse> {
    return this.categories.get(id);
  }

  @RequirePermission('create', 'Category')
  @Post()
  create(@Body(new ZodValidationPipe(categoryRequestSchema)) body: CategoryRequest): Promise<CategoryResponse> {
    return this.categories.create(body);
  }

  @RequirePermission('update', 'Category')
  @Patch(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(categoryRequestSchema)) body: CategoryRequest): Promise<CategoryResponse> {
    return this.categories.rename(id, body);
  }

  @RequirePermission('update', 'Category')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryResponse> {
    return this.categories.activate(id);
  }

  @RequirePermission('delete', 'Category')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryResponse> {
    return this.categories.deactivate(id);
  }

  @RequirePermission('read', 'Category')
  @Get(':id/visibility')
  visibility(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryVisibilityResponse> {
    return this.categories.visibility(id);
  }

  @RequirePermission('update', 'Category')
  @Put(':id/visibility')
  replaceVisibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(replaceCategoryVisibilitySchema)) body: ReplaceCategoryVisibilityRequest,
  ): Promise<CategoryVisibilityResponse> {
    return this.categories.replaceVisibility(id, body);
  }
}
