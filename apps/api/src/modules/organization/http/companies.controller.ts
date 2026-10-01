import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type CompanyResponse,
  type CreateCompanyRequest,
  createCompanyRequestSchema,
  type Page,
  type PageQuery,
  pageQuerySchema,
  type UpdateCompanyRequest,
  updateCompanyRequestSchema,
} from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { CompaniesService } from '../application/companies.service.js';

@Controller('companies')
export class CompaniesController {
  constructor(@Inject(CompaniesService) private readonly companies: CompaniesService) {}

  @RequirePermission('read', 'Company')
  @Get()
  list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery): Promise<Page<CompanyResponse>> {
    return this.companies.list(query);
  }

  @RequirePermission('read', 'Company')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CompanyResponse> {
    return this.companies.get(id);
  }

  @RequirePermission('create', 'Company')
  @Post()
  create(@Body(new ZodValidationPipe(createCompanyRequestSchema)) body: CreateCompanyRequest): Promise<CompanyResponse> {
    return this.companies.create(body);
  }

  @RequirePermission('update', 'Company')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateCompanyRequestSchema)) body: UpdateCompanyRequest): Promise<CompanyResponse> {
    return this.companies.update(id, body);
  }

  @RequirePermission('update', 'Company')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<CompanyResponse> {
    return this.companies.activate(id);
  }

  /** Deactivating is the "delete" of configuration that may be in use: nothing is physically removed. */
  @RequirePermission('delete', 'Company')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<CompanyResponse> {
    return this.companies.deactivate(id);
  }

  @RequirePermission('update', 'Company')
  @Post(':id/make-default')
  @HttpCode(HttpStatus.OK)
  makeDefault(@Param('id', ParseUUIDPipe) id: string): Promise<CompanyResponse> {
    return this.companies.makeDefault(id);
  }
}
