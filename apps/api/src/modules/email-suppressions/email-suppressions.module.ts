import { Module } from '@nestjs/common';
import { SesEventsService } from './application/ses-events.service.js';
import { SnsClient } from './application/sns-client.js';
import { EmailSuppressionRepository } from './data/email-suppression.repository.js';
import { SesEventsController } from './http/ses-events.controller.js';

/** SES bounces and complaints, received from SNS and kept as suppressed addresses (docs/base-de-datos.md §8.34). */
@Module({
  controllers: [SesEventsController],
  providers: [{ provide: SnsClient, useFactory: () => new SnsClient() }, SesEventsService, EmailSuppressionRepository],
})
export class EmailSuppressionsModule {}
