import { Controller, Get, Inject, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { DatabaseHealthService } from '../../infrastructure/database/database-health.service.js';
import { RateLimit, RateLimitGuard, type RateLimitPolicy } from '../auth/rate-limit.js';
import { Public } from '../auth/public.decorator.js';

const MINUTE = 60_000;
/** `/ready` is public and hits the database: cheap but bounded per address. */
const READY_RATE_LIMIT: RateLimitPolicy = { name: 'ready', perIp: { limit: 120, windowMs: MINUTE }, perIdentifier: { limit: 120, windowMs: MINUTE } };

@Public()
@Controller()
export class HealthController {
  constructor(@Inject(DatabaseHealthService) private readonly database: DatabaseHealthService) {}

  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @RateLimit(READY_RATE_LIMIT)
  @UseGuards(RateLimitGuard)
  async ready(): Promise<{ status: 'ready' }> {
    if (!(await this.database.isReachable())) throw new ServiceUnavailableException('Database unreachable');
    return { status: 'ready' };
  }
}
