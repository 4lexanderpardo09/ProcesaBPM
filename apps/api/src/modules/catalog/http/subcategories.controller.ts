import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateSubcategoryRequest,
  createSubcategoryRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type SubcategoriesQuery,
  type SubcategoryResponse,
  subcategoriesQuerySchema,
  type UpdateSubcategoryRequest,
  updateSubcategoryRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { SubcategoriesService } from '../application/subcategories.service.js';

@Controller('subcategories')
export class SubcategoriesController {
  constructor(@Inject(SubcategoriesService) private readonly subcategories: SubcategoriesService) {}

  /** `categoryId` lists the subcategories of one category. */
  @RequirePermission('read', 'Subcategory')
  @Get()
  list(
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
    @Query(new ZodValidationPipe(subcategoriesQuerySchema)) filter: SubcategoriesQuery,
  ): Promise<Page<SubcategoryResponse>> {
    return this.subcategories.list(query, filter.categoryId);
  }

  @RequirePermission('read', 'Subcategory')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SubcategoryResponse> {
    return this.subcategories.get(id);
  }

  @RequirePermission('create', 'Subcategory')
  @Post()
  create(@Body(new ZodValidationPipe(createSubcategoryRequestSchema)) body: CreateSubcategoryRequest): Promise<SubcategoryResponse> {
    return this.subcategories.create(body);
  }

  @RequirePermission('update', 'Subcategory')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSubcategoryRequestSchema)) body: UpdateSubcategoryRequest): Promise<SubcategoryResponse> {
    return this.subcategories.update(id, body);
  }

  @RequirePermission('update', 'Subcategory')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<SubcategoryResponse> {
    return this.subcategories.activate(id);
  }

  @RequirePermission('delete', 'Subcategory')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<SubcategoryResponse> {
    return this.subcategories.deactivate(id);
  }
}
