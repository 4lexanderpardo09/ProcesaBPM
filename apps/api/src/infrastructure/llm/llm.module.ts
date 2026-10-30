import { Module } from '@nestjs/common';
import { WORKER_SETTINGS, type WorkerSettings } from '../../config/worker-settings.js';
import { AnthropicProvider, ANTHROPIC } from './anthropic-provider.js';
import { LlmProvider } from './llm-provider.js';
import { OpenAiCompatibleProvider, UnconfiguredLlmProvider } from './openai-compatible-provider.js';

/** The language model the worker talks to. Only the worker imports it: the API never holds the key. */
@Module({
  providers: [
    {
      provide: LlmProvider,
      inject: [WORKER_SETTINGS],
      useFactory: (settings: WorkerSettings): LlmProvider => {
        const { AI_API_KEY: apiKey, AI_BASE_URL: baseUrl, AI_PROVIDER_NAME: name, AI_REASONING_MODEL: model, AI_REQUEST_TIMEOUT_MS: timeoutMs } = settings;
        if (apiKey === undefined) return new UnconfiguredLlmProvider(name, model);
        if (name === ANTHROPIC) return new AnthropicProvider({ apiKey, model, effort: settings.AI_EFFORT, timeoutMs, ...(baseUrl === undefined ? {} : { baseUrl }) });
        // The settings refuse an OpenAI-compatible provider without its URL.
        return new OpenAiCompatibleProvider({ providerName: name, baseUrl: baseUrl ?? '', apiKey, model, strictTools: settings.AI_STRICT_TOOLS, timeoutMs });
      },
    },
  ],
  exports: [LlmProvider],
})
export class LlmModule {}
