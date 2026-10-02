import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type EntryPoint, loadConfig } from './app-config.js';
import { APP_CONFIG } from './tokens.js';
import { loadWorkerSettings, WORKER_SETTINGS } from './worker-settings.js';

@Global()
@Module({})
export class ConfigModule {
  /** Reads and validates the environment of one entry point; startup fails when it is not valid. */
  static forEntry(entry: EntryPoint): DynamicModule {
    const workerOnly = entry === 'worker' ? [{ provide: WORKER_SETTINGS, useFactory: () => loadWorkerSettings(process.env) }] : [];
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env, entry) }, ...workerOnly],
      exports: [APP_CONFIG, ...workerOnly.map((provider) => provider.provide)],
    };
  }
}
