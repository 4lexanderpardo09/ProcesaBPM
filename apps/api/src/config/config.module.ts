import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import { type EntryPoint, loadApiConfig, loadWorkerConfig } from './app-config.js';
import { API_CONFIG, APP_CONFIG } from './tokens.js';
import { loadWorkerSettings, WORKER_SETTINGS } from './worker-settings.js';

@Global()
@Module({})
export class ConfigModule {
  /**
   * Reads and validates the environment of one entry point; startup fails when it is not valid. `API_CONFIG` exists in the
   * API only, so a provider of the worker that asks for it fails at boot instead of reading a variable the worker lacks.
   */
  static forEntry(entry: EntryPoint): DynamicModule {
    const providers: Provider[] =
      entry === 'api'
        ? [
            { provide: API_CONFIG, useFactory: () => loadApiConfig(process.env) },
            { provide: APP_CONFIG, useExisting: API_CONFIG },
          ]
        : [
            { provide: APP_CONFIG, useFactory: () => loadWorkerConfig(process.env) },
            { provide: WORKER_SETTINGS, useFactory: () => loadWorkerSettings(process.env) },
          ];
    return { module: ConfigModule, providers, exports: providers.map((provider) => (provider as { provide: symbol }).provide) };
  }
}
