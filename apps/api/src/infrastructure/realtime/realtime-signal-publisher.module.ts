import { Module } from '@nestjs/common';
import { RealtimeSignalPublisher } from './realtime-signal-publisher.js';

/** Worker only: the API instances listen, they never publish. */
@Module({ providers: [RealtimeSignalPublisher], exports: [RealtimeSignalPublisher] })
export class RealtimeSignalPublisherModule {}
