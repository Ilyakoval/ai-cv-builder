import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AnthropicLlmClient } from './anthropic.client';
import { FakeLlmClient } from './fake.client';
import { LLM_CLIENT } from './llm.types';

@Global()
@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.LLM_PROVIDER === 'fake') return new FakeLlmClient(config.NODE_ENV === 'test' ? 0 : 1500);
        if (!config.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
        return new AnthropicLlmClient(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL, config.LLM_TIMEOUT_MS);
      },
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
