import { Module } from '@nestjs/common';
import { RateLimitModule } from '../../infrastructure/security/rate-limit.module.js';
import { DemoRequestService } from './application/demo-request.service.js';
import { DemoRequestRepository } from './data/demo-request.repository.js';
import { DemoRequestsController } from './http/demo-requests.controller.js';

/** The website's demo form on the API. The platform console lists the requests (modules/platform). */
@Module({ imports: [RateLimitModule], controllers: [DemoRequestsController], providers: [DemoRequestRepository, DemoRequestService] })
export class DemoRequestsModule {}
