import { Module } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { LlmProvider } from './llm-provider.js';
import { OpenAiCompatibleProvider, UnconfiguredLlmProvider } from './openai-compatible-provider.js';

/** The language model the worker talks to. Only the worker imports it: the API never holds the key. */
@Module({
  providers: [
    {
      provide: LlmProvider,
      inject: [WORKER_SETTINGS],
      useFactory: (settings: WorkerSettings): LlmProvider =>
        settings.AI_API_KEY === undefined
          ? new UnconfiguredLlmProvider(settings.AI_PROVIDER_NAME, settings.AI_REASONING_MODEL)
          : new OpenAiCompatibleProvider({
              providerName: settings.AI_PROVIDER_NAME,
              baseUrl: settings.AI_BASE_URL,
              apiKey: settings.AI_API_KEY,
              model: settings.AI_REASONING_MODEL,
              strictTools: settings.AI_STRICT_TOOLS,
              timeoutMs: settings.AI_REQUEST_TIMEOUT_MS,
            }),
    },
  ],
  exports: [LlmProvider],
})
export class LlmModule {}
