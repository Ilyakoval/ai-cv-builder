import { LlmClient, LlmToolRequest } from '../src/llm/llm.types';

type Handler = (req: LlmToolRequest) => unknown | Promise<unknown>;

/** Test double: returns queued responses (or throws queued errors) and records every request. */
export class ScriptedLlm implements LlmClient {
  readonly calls: LlmToolRequest[] = [];
  private queue: Handler[] = [];

  push(...handlers: (Handler | object)[]) {
    for (const h of handlers) this.queue.push(typeof h === 'function' ? (h as Handler) : () => h);
    return this;
  }

  reset() {
    this.calls.length = 0;
    this.queue = [];
  }

  async callTool(req: LlmToolRequest): Promise<unknown> {
    this.calls.push(req);
    const next = this.queue.shift();
    if (!next) throw new Error(`ScriptedLlm: no response queued for ${req.purpose}`);
    return next(req);
  }
}
