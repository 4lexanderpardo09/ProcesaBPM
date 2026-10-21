import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type FieldOptionsQuery, fieldOptionsQuerySchema, type FieldOptionsResponse } from '@procesabpm/shared';
import { RequireAnyPermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { FieldOptionsService } from '../../engine/application/field-options.service.js';

/** Whoever fills a form: creating a ticket (for oneself or for someone else) or moving one forward on a step. */
const FORM_FILLERS = ['create', 'create_for_others', 'transition'];

/** The choices of a form field that stores people, sites or preset entries (datasets have their own route). */
@Controller('fields')
export class FieldOptionsController {
  constructor(@Inject(FieldOptionsService) private readonly fieldOptions: FieldOptionsService) {}

  @RequireAnyPermission(FORM_FILLERS, 'Ticket')
  @Get(':fieldId/options')
  list(@Param('fieldId', ParseUUIDPipe) fieldId: string, @Query(new ZodValidationPipe(fieldOptionsQuerySchema)) query: FieldOptionsQuery): Promise<FieldOptionsResponse> {
    return this.fieldOptions.options(fieldId, query);
  }
}
