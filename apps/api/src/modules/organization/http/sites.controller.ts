import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CreateSiteRequest,
  createSiteRequestSchema,
  type MoveSiteRequest,
  moveSiteRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type SiteResponse,
  type SiteTreeNode,
  type UpdateSiteRequest,
  updateSiteRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { SitesService } from '../application/sites.service.js';

@Controller('sites')
export class SitesController {
  constructor(@Inject(SitesService) private readonly sites: SitesService) {}

  @RequirePermission('read', 'Site')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<SiteResponse>> {
    return this.sites.list(query);
  }

  /** Declared before `:id`, which would otherwise take "tree" as an id. */
  @RequirePermission('read', 'Site')
  @Get('tree')
  tree(@Query('includeInactive') includeInactive?: string): Promise<SiteTreeNode[]> {
    return this.sites.tree(includeInactive === 'true');
  }

  @RequirePermission('read', 'Site')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<SiteResponse> {
    return this.sites.get(id);
  }

  @RequirePermission('create', 'Site')
  @Post()
  create(@Body(new ZodValidationPipe(createSiteRequestSchema)) body: CreateSiteRequest): Promise<SiteResponse> {
    return this.sites.create(body);
  }

  @RequirePermission('update', 'Site')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSiteRequestSchema)) body: UpdateSiteRequest): Promise<SiteResponse> {
    return this.sites.update(id, body);
  }

  @RequirePermission('update', 'Site')
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  move(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(moveSiteRequestSchema)) body: MoveSiteRequest): Promise<SiteResponse> {
    return this.sites.move(id, body.parentId);
  }

  @RequirePermission('update', 'Site')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<SiteResponse> {
    return this.sites.activate(id);
  }

  @RequirePermission('delete', 'Site')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<SiteResponse> {
    return this.sites.deactivate(id);
  }
}
