import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { Public } from '../../../common/auth/public.decorator.js';
import { SesEventsService } from '../application/ses-events.service.js';

/**
 * Where the SNS topic of Amazon SES posts bounces and complaints (and its subscription confirmation). Public: SNS has no
 * session; the service authenticates every message by its signature instead. Under /api/public/*, which both the app's
 * and the website's hosts forward to the API.
 */
@Controller('public/email-events')
export class SesEventsController {
  constructor(@Inject(SesEventsService) private readonly events: SesEventsService) {}

  @Public()
  @Post('ses')
  @HttpCode(HttpStatus.NO_CONTENT)
  receive(@Body() body: unknown): Promise<void> {
    return this.events.receive(body);
  }
}
