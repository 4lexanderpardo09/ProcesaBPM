import { Controller, Get, Inject } from '@nestjs/common';
import type { StorageUsageResponse } from '@procesabpm/shared';
import { RequirePermission } from '../../../common/auth/route-access.js';
import { StorageUsageService } from '../application/storage-usage.service.js';

@Controller('storage')
export class StorageUsageController {
  constructor(@Inject(StorageUsageService) private readonly usage: StorageUsageService) {}

  @RequirePermission('read', 'Storage')
  @Get('usage')
  get(): Promise<StorageUsageResponse> {
    return this.usage.get();
  }
}
