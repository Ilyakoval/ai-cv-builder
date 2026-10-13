/**
 * Provider-agnostic contract. The pipeline only ever asks the model to call a
 * single tool with a JSON-schema'd input; the result is `unknown` on purpose —
 * LLM output is untrusted and must be validated by the caller.
 */
export interface LlmToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmToolRequest {
  system: string;
  user: string;
  tool: LlmToolSpec;
  maxTokens: number;
  /** Used only for logs/metrics. */
  purpose: string;
}

export interface LlmClient {
  callTool(req: LlmToolRequest): Promise<unknown>;
}

export const LLM_CLIENT = Symbol('LLM_CLIENT');

/** Worth retrying later (rate limit, overload, network, timeout). */
export class LlmTransientError extends Error {
  override name = 'LlmTransientError';
}

/** Retrying will not help (bad key, invalid request, refused). */
export class LlmFatalError extends Error {
  override name = 'LlmFatalError';
}

/** The model answered, but not in the shape we asked for. */
export class LlmOutputError extends Error {
  override name = 'LlmOutputError';
}
