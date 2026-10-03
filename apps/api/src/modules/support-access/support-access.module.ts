import { Module } from '@nestjs/common';
import { SupportAccessService } from './application/support-access.service.js';
import { SupportAccessRepository } from './data/support-access.repository.js';
import { SupportAccessController } from './http/support-access.controller.js';

/** What a tenant administrator controls about support access: grants (read-only, up to 72 hours) and their history. */
@Module({ controllers: [SupportAccessController], providers: [SupportAccessRepository, SupportAccessService] })
export class SupportAccessModule {}
