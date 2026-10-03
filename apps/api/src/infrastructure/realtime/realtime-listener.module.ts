import { Module } from '@nestjs/common';
import type { ApiConfig } from '../../config/app-config.js';
import { API_CONFIG } from '../../config/tokens.js';
import { LISTENER_CLIENT_FACTORY, PgSignalListener, pgListenerClientFactory } from './pg-signal-listener.js';
import { RealtimeSignalSource } from './realtime-signal-source.js';

/** The API's side of the signals: one listening connection per instance. Never imported by the worker. */
@Module({
  providers: [
    { provide: LISTENER_CLIENT_FACTORY, useFactory: (config: ApiConfig) => pgListenerClientFactory(config), inject: [API_CONFIG] },
    PgSignalListener,
    { provide: RealtimeSignalSource, useExisting: PgSignalListener },
  ],
  exports: [RealtimeSignalSource, PgSignalListener],
})
export class RealtimeListenerModule {}
