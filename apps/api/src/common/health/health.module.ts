import { Module } from '@nestjs/common';
import { RateLimitModule } from '../../infrastructure/security/rate-limit.module.js';
import { HealthController } from './health.controller.js';

@Module({ imports: [RateLimitModule], controllers: [HealthController] })
export class HealthModule {}
