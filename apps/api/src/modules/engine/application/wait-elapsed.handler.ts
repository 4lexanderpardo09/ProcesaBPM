import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { Clock } from '../../../infrastructure/clock.js';
import type { WorkerTransaction } from '../../../infrastructure/database/worker-transaction-runner.js';
import { type ClaimedEvent } from '../../../infrastructure/outbox/outbox-handler.js';
import { OutboxHandlerRegistry } from '../../../infrastructure/outbox/outbox-handler.registry.js';
import { PermanentEventError } from '../../../infrastructure/outbox/outbox-handler.js';
import { ResumeWaitService } from './resume-wait.service.js';

const payloadSchema = z.object({ ticketId: z.uuid(), visitId: z.uuid(), stepId: z.uuid() }).strict();
type Payload = z.infer<typeof payloadSchema>;

/** Resumes the ticket whose WAIT block elapsed, inside the transaction that completes the event (exactly once). */
@Injectable()
export class WaitElapsedHandler implements OnModuleInit {
  constructor(
    @Inject(OutboxHandlerRegistry) private readonly registry: OutboxHandlerRegistry,
    @Inject(ResumeWaitService) private readonly resumes: ResumeWaitService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.registry.registerTransactional({ type: 'ticket.wait_elapsed', schema: payloadSchema, handle: (tx, event) => this.handle(tx, event) });
  }

  private async handle(tx: WorkerTransaction, event: ClaimedEvent<Payload>): Promise<void> {
    if (event.tenantId === null) throw new PermanentEventError('A wait-elapsed event belongs to a tenant');
    await this.resumes.resume(tx, event.tenantId, event.payload, this.clock.now());
  }
}
