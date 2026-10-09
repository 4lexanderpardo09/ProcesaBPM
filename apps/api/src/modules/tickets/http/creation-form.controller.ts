import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type CreationFormQuery, creationFormQuerySchema, type CreationFormResponse } from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import type { AppAbility } from '../../authorization/domain/build-ability.js';
import { CurrentAbility } from '../../authorization/http/current-ability.decorator.js';
import { CreationFormService } from '../../engine/application/creation-form.service.js';
import { ticketCreatorOf } from '../application/ticket-access.js';
import { TICKET_SUBJECT } from '../domain/ticket-subject.js';

/** The form to create a ticket of a subcategory for oneself (the catalog lists the subcategories, this draws one). */
@Controller('subcategories')
export class CreationFormController {
  constructor(@Inject(CreationFormService) private readonly forms: CreationFormService) {}

  @RequirePermission('create', TICKET_SUBJECT)
  @Get(':id/creation-form')
  get(@CurrentPrincipal() principal: Principal, @CurrentAbility() ability: AppAbility, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(creationFormQuerySchema)) query: CreationFormQuery): Promise<CreationFormResponse> {
    return this.forms.form(ticketCreatorOf(principal, ability), id, query.companyId);
  }
}
