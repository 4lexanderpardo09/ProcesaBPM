import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type DatasetLookupQuery, datasetLookupQuerySchema, type DatasetLookupResponse, type DatasetOptionsQuery, datasetOptionsQuerySchema, type DatasetOptionsResponse } from '@procesabpm/shared';
import { RequireAnyPermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { DatasetOptionsService } from '../application/dataset-options.service.js';

/** Whoever fills a form: creating a ticket (for oneself or for someone else) or moving one forward on a step. */
const FORM_FILLERS = ['create', 'create_for_others', 'transition'];

/** The values of a form field fed by a dataset, asked by the field (never by the dataset). */
@Controller('fields')
export class DatasetFieldsController {
  constructor(@Inject(DatasetOptionsService) private readonly options: DatasetOptionsService) {}

  @RequireAnyPermission(FORM_FILLERS, 'Ticket')
  @Get(':fieldId/dataset-options')
  list(@Param('fieldId', ParseUUIDPipe) fieldId: string, @Query(new ZodValidationPipe(datasetOptionsQuerySchema)) query: DatasetOptionsQuery): Promise<DatasetOptionsResponse> {
    return this.options.options(fieldId, query);
  }

  @RequireAnyPermission(FORM_FILLERS, 'Ticket')
  @Get(':fieldId/dataset-lookup')
  lookup(@Param('fieldId', ParseUUIDPipe) fieldId: string, @Query(new ZodValidationPipe(datasetLookupQuerySchema)) query: DatasetLookupQuery): Promise<DatasetLookupResponse> {
    return this.options.lookup(fieldId, query.key);
  }
}
