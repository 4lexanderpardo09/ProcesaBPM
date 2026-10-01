import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class DatabaseHealthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async isReachable(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
