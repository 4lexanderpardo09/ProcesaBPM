import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  type CreateDatasetRequest,
  createDatasetRequestSchema,
  type DatasetListQuery,
  datasetListQuerySchema,
  type DatasetResponse,
  type DatasetRowData,
  type DatasetRowsQuery,
  datasetRowsQuerySchema,
  type Page,
  type ReloadDatasetRequest,
  reloadDatasetRequestSchema,
  type UpdateDatasetRequest,
  updateDatasetRequestSchema,
} from '@procesabpm/shared';
import { Audited } from '../../../common/audit/audited.decorator.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { DatasetsService } from '../application/datasets.service.js';

/** Datasets are part of configuring workflows (the source of field values): the workflow permissions govern them. */
@Controller('datasets')
export class DatasetsController {
  constructor(@Inject(DatasetsService) private readonly datasets: DatasetsService) {}

  @RequirePermission('read', 'Workflow')
  @Get()
  list(@Query(new ZodValidationPipe(datasetListQuerySchema)) query: DatasetListQuery): Promise<Page<DatasetResponse>> {
    return this.datasets.list(query);
  }

  @RequirePermission('read', 'Workflow')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<DatasetResponse> {
    return this.datasets.get(id);
  }

  @RequirePermission('read', 'Workflow')
  @Get(':id/rows')
  rows(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(datasetRowsQuerySchema)) query: DatasetRowsQuery): Promise<Page<DatasetRowData>> {
    return this.datasets.rows(id, query);
  }

  @RequirePermission('update', 'Workflow')
  @Audited('dataset.created')
  @Post()
  create(@Body(new ZodValidationPipe(createDatasetRequestSchema)) body: CreateDatasetRequest): Promise<DatasetResponse> {
    return this.datasets.create(body);
  }

  @RequirePermission('update', 'Workflow')
  @Audited('dataset.reloaded')
  @Put(':id/content')
  reload(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reloadDatasetRequestSchema)) body: ReloadDatasetRequest): Promise<DatasetResponse> {
    return this.datasets.reload(id, body);
  }

  @RequirePermission('update', 'Workflow')
  @Audited('dataset.updated')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateDatasetRequestSchema)) body: UpdateDatasetRequest): Promise<DatasetResponse> {
    return this.datasets.update(id, body);
  }

  @RequirePermission('update', 'Workflow')
  @Audited('dataset.deleted')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.datasets.remove(id);
  }
}
