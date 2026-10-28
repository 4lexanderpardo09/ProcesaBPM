import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { type DemoRequest, demoRequestSchema } from '@procesabpm/shared';
import { Public } from '../../../common/auth/public.decorator.js';
import { RateLimit, RateLimitGuard } from '../../../common/auth/rate-limit.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { DemoRequestService } from '../application/demo-request.service.js';
import { DEMO_REQUEST_RATE_LIMIT } from '../domain/demo-request-policy.js';

/** The website's demo form (apps/landing). Public: whoever visits the site can send it. */
@Controller('public/demo-requests')
export class DemoRequestsController {
  constructor(@Inject(DemoRequestService) private readonly demoRequests: DemoRequestService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(DEMO_REQUEST_RATE_LIMIT)
  @UseGuards(RateLimitGuard)
  submit(@Body(new ZodValidationPipe(demoRequestSchema)) body: DemoRequest): Promise<void> {
    return this.demoRequests.submit(body);
  }
}
