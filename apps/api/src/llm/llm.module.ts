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
      useFactory: (config: AppConfig) =>
        config.LLM_PROVIDER === 'fake'
          ? new FakeLlmClient(config.NODE_ENV === 'test' ? 0 : 1500)
          : new AnthropicLlmClient(config.ANTHROPIC_API_KEY!, config.ANTHROPIC_MODEL, config.LLM_TIMEOUT_MS),
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
