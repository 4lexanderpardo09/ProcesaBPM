import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseHealthService } from '../../infrastructure/database/database-health.service.js';
import { Public } from '../auth/public.decorator.js';

@Public()
@Controller()
export class HealthController {
  constructor(@Inject(DatabaseHealthService) private readonly database: DatabaseHealthService) {}

  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ready' }> {
    if (!(await this.database.isReachable())) throw new ServiceUnavailableException('Database unreachable');
    return { status: 'ready' };
  }
}
