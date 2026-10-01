import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type EntryPoint, loadConfig } from './app-config.js';
import { APP_CONFIG } from './tokens.js';

@Global()
@Module({})
export class ConfigModule {
  /** Reads and validates the environment of one entry point; startup fails when it is not valid. */
  static forEntry(entry: EntryPoint): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig(process.env, entry) }],
      exports: [APP_CONFIG],
    };
  }
}
