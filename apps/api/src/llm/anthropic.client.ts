import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { LlmClient, LlmFatalError, LlmOutputError, LlmToolRequest, LlmTransientError } from './llm.types';

export class AnthropicLlmClient implements LlmClient {
  private readonly logger = new Logger(AnthropicLlmClient.name);
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    timeoutMs: number,
  ) {
    // SDK-level retries cover short blips; longer outages are retried by the
    // job queue with backoff so we do not hold a worker slot for minutes.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });
  }

  async callTool(req: LlmToolRequest): Promise<unknown> {
    const started = Date.now();
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        tools: [
          {
            name: req.tool.name,
            description: req.tool.description,
            input_schema: req.tool.inputSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: req.tool.name },
      });
    } catch (err) {
      throw this.mapError(err);
    }

    this.logger.log(
      `${req.purpose}: model=${response.model} in=${response.usage.input_tokens} out=${response.usage.output_tokens} ` +
        `stop=${response.stop_reason} ${Date.now() - started}ms`,
    );

    if (response.stop_reason === 'max_tokens') {
      throw new LlmOutputError('Model output was truncated (max_tokens reached)');
    }
    if (response.stop_reason === 'refusal') {
      throw new LlmFatalError('The model declined to process this input');
    }
    const block = response.content.find((b) => b.type === 'tool_use' && b.name === req.tool.name);
    if (!block || block.type !== 'tool_use') {
      throw new LlmOutputError('Model did not call the expected tool');
    }
    return block.input;
  }

  private mapError(err: unknown): Error {
    if (err instanceof Anthropic.APIConnectionError) {
      // Includes timeouts (APIConnectionTimeoutError extends it).
      return new LlmTransientError(`Anthropic connection error: ${err.message}`);
    }
    if (err instanceof Anthropic.APIError) {
      const status = err.status ?? 0;
      if (status === 408 || status === 409 || status === 429 || status >= 500) {
        return new LlmTransientError(`Anthropic API ${status}: ${err.message}`);
      }
      return new LlmFatalError(`Anthropic API ${status}: ${err.message}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
