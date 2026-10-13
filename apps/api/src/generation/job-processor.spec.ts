import { LlmFatalError, LlmOutputError, LlmTransientError } from '../llm/llm.types';
import { SectionConflictError } from './pipeline/assemble';
import { isRetryable, userMessage } from './job-processor';

describe('job failure policy', () => {
  it.each([
    [new LlmTransientError('529 overloaded'), true],
    [new LlmOutputError('bad json'), true],
    [new Error('ECONNRESET'), true],
    [new LlmFatalError('401 invalid x-api-key'), false],
    [new SectionConflictError(), false],
  ])('%s retryable=%s', (err, expected) => {
    expect(isRetryable(err)).toBe(expected);
  });

  it('never leaks provider details to users', () => {
    const msg = userMessage(new LlmFatalError('401 invalid x-api-key sk-ant-123'), true);
    expect(msg).not.toMatch(/401|api-key|sk-ant/);
  });
});
