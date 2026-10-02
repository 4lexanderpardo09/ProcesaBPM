import { Module } from '@nestjs/common';
import { AvailableCatalogService } from './application/available-catalog.service.js';
import { ErrorTypesService } from './application/error-types.service.js';
import { CategoriesService } from './application/categories.service.js';
import { PrioritiesService } from './application/priorities.service.js';
import { SubcategoriesService } from './application/subcategories.service.js';
import { CategoryRepository } from './data/category.repository.js';
import { ErrorTypeRepository } from './data/error-type.repository.js';
import { MembershipCompaniesRepository } from './data/membership-companies.repository.js';
import { PriorityRepository } from './data/priority.repository.js';
import { SubcategoryRepository } from './data/subcategory.repository.js';
import { AvailableCatalogController } from './http/available-catalog.controller.js';
import { CategoriesController } from './http/categories.controller.js';
import { ErrorTypesController } from './http/error-types.controller.js';
import { PrioritiesController } from './http/priorities.controller.js';
import { SubcategoriesController } from './http/subcategories.controller.js';

/** Priorities, categories (with their visibility), subcategories, error types and subtypes, plus what a ticket creator can pick. */
@Module({
  controllers: [PrioritiesController, CategoriesController, SubcategoriesController, AvailableCatalogController, ErrorTypesController],
  providers: [
    PriorityRepository,
    CategoryRepository,
    SubcategoryRepository,
    MembershipCompaniesRepository,
    ErrorTypeRepository,
    ErrorTypesService,
    PrioritiesService,
    CategoriesService,
    SubcategoriesService,
    AvailableCatalogService,
  ],
})
export class CatalogModule {}
