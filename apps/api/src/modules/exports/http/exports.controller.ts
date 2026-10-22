import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  type DownloadUrlResponse,
  type ExportCatalogResponse,
  exportCatalogNameSchema,
  type ExportCutoffResponse,
  type ExportDefinitionResponse,
  type ExportLineResponse,
  type ExportPreviewResponse,
  type GenerateExportCutoffResponse,
  type SaveExportCatalogRequest,
  saveExportCatalogRequestSchema,
  type SaveExportDefinitionRequest,
  saveExportDefinitionRequestSchema,
  uuidSchema,
} from '@procesabpm/shared';
import { z } from 'zod';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { AuthenticatedOnly, RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { ExportsService } from '../application/exports.service.js';

const uuid = new ParseUUIDPipe();
const linesQuerySchema = z.object({ pending: z.enum(['true', 'false']).optional(), cutoffId: uuidSchema.optional() });

/** Scheduled exports ("planos"): definitions, their files and lines, and "generate now". */
@Controller('exports')
export class ExportsController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  @RequirePermission('read', 'Export')
  @Get()
  list(): Promise<ExportDefinitionResponse[]> {
    return this.exports.list();
  }

  @RequirePermission('read', 'Export')
  @Get(':id')
  get(@Param('id', uuid) id: string): Promise<ExportDefinitionResponse> {
    return this.exports.get(id);
  }

  @RequirePermission('update', 'Export')
  @Post()
  @Audited('export.created')
  create(@Body(new ZodValidationPipe(saveExportDefinitionRequestSchema)) body: SaveExportDefinitionRequest): Promise<ExportDefinitionResponse> {
    return this.exports.create(body);
  }

  @RequirePermission('update', 'Export')
  @Put(':id')
  @Audited('export.updated')
  update(@Param('id', uuid) id: string, @Body(new ZodValidationPipe(saveExportDefinitionRequestSchema)) body: SaveExportDefinitionRequest): Promise<ExportDefinitionResponse> {
    return this.exports.update(id, body);
  }

  @RequirePermission('update', 'Export')
  @Delete(':id')
  @Audited('export.deleted')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', uuid) id: string): Promise<void> {
    return this.exports.remove(id);
  }

  /** The row of the newest ticket: personal data (names, amounts), so only for whoever configures exports. */
  @RequirePermission('update', 'Export')
  @Get(':id/preview')
  preview(@Param('id', uuid) id: string): Promise<ExportPreviewResponse> {
    return this.exports.preview(id);
  }

  @RequirePermission('read', 'Export')
  @Get(':id/cutoffs')
  cutoffs(@Param('id', uuid) id: string): Promise<ExportCutoffResponse[]> {
    return this.exports.cutoffsOf(id);
  }

  @RequirePermission('generate', 'Export')
  @Post(':id/cutoffs')
  @HttpCode(HttpStatus.OK)
  @Audited('export.generated')
  generate(@Param('id', uuid) id: string): Promise<GenerateExportCutoffResponse> {
    return this.exports.generateNow(id);
  }

  @RequirePermission('read', 'Export')
  @Get(':id/lines')
  lines(@Param('id', uuid) id: string, @Query(new ZodValidationPipe(linesQuerySchema)) query: z.infer<typeof linesQuerySchema>): Promise<ExportLineResponse[]> {
    return this.exports.linesOf(id, { ...(query.pending === undefined ? {} : { pending: query.pending === 'true' }), ...(query.cutoffId === undefined ? {} : { cutoffId: query.cutoffId }) });
  }
}

/** The files of the exports: every one for whoever reads exports, and "Mis planos" (the caller's own) for any member. */
@Controller('export-cutoffs')
export class ExportCutoffsController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  @AuthenticatedOnly()
  @Get('mine')
  mine(): Promise<ExportCutoffResponse[]> {
    return this.exports.mine();
  }

  @AuthenticatedOnly()
  @Get('mine/:cutoffId/download-url')
  @Audited('export.download_url_issued')
  myDownloadUrl(@Param('cutoffId', uuid) cutoffId: string): Promise<DownloadUrlResponse> {
    return this.exports.downloadUrl(cutoffId, true);
  }

  @RequirePermission('read', 'Export')
  @Get(':cutoffId/download-url')
  @Audited('export.download_url_issued')
  downloadUrl(@Param('cutoffId', uuid) cutoffId: string): Promise<DownloadUrlResponse> {
    return this.exports.downloadUrl(cutoffId, false);
  }
}

/** Translation tables of CATALOG columns. */
@Controller('export-catalogs')
export class ExportCatalogsController {
  constructor(@Inject(ExportsService) private readonly exports: ExportsService) {}

  @RequirePermission('read', 'Export')
  @Get()
  names(): Promise<string[]> {
    return this.exports.catalogNames();
  }

  @RequirePermission('read', 'Export')
  @Get(':catalog')
  catalog(@Param('catalog', new ZodValidationPipe(exportCatalogNameSchema)) catalog: string): Promise<ExportCatalogResponse> {
    return this.exports.catalog(catalog);
  }

  @RequirePermission('update', 'Export')
  @Put(':catalog')
  @Audited('export_catalog.updated')
  save(@Param('catalog', new ZodValidationPipe(exportCatalogNameSchema)) catalog: string, @Body(new ZodValidationPipe(saveExportCatalogRequestSchema)) body: SaveExportCatalogRequest): Promise<ExportCatalogResponse> {
    return this.exports.saveCatalog(catalog, body);
  }
}
