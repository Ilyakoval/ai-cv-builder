import { normalizePhone } from '@cvb/shared';
import { Logger } from '@nestjs/common';
import { LlmClient, LlmToolRequest } from './llm.types';

/**
 * Offline stand-in for Claude, selected with LLM_PROVIDER=fake. It lets the
 * whole flow (queue, progress, questions, editing, PDF) run without an API key
 * and makes tests deterministic. It is intentionally dumb — it only copies
 * text from the input — so it can never "invent" anything either.
 */
export class FakeLlmClient implements LlmClient {
  private readonly logger = new Logger(FakeLlmClient.name);

  constructor(private readonly delayMs = 1500) {}

  async callTool(req: LlmToolRequest): Promise<unknown> {
    this.logger.log(`fake ${req.purpose}`);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (req.tool.name === 'submit_cv_draft') return fakeDraft(req.user);
    if (req.tool.name === 'submit_section_update') return fakeSectionUpdate(req.user, req.tool.inputSchema);
    throw new Error(`FakeLlmClient: unknown tool ${req.tool.name}`);
  }
}

const tag = (text: string, name: string) => {
  const m = text.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m?.[1]?.trim() ?? '';
};

export function fakeDraft(message: string) {
  const source = tag(message, 'source');
  const lines = source.split('\n').map((l) => l.replace(/^[\s•*-]+/, '').trim()).filter(Boolean);
  const email = source.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? '';
  // normalizePhone rejects year ranges ("2013-2017") that look phone-like.
  const phone = (source.match(/\+?\d[\d\s().-]{5,18}\d/g) ?? []).find((c) => normalizePhone(c)) ?? '';
  const first = lines[0] ?? '';
  const fullName = /^[\p{L}' -]{3,60}$/u.test(first) && first.split(' ').length <= 4 ? first : '';
  const sentences = lines
    .filter((l) => l !== first && !l.includes(email || '\u0000') && l.length > 25)
    .slice(0, 5);

  return {
    contact: { fullName, email, phone, location: '', links: [] },
    summary: { text: '', evidence: [] },
    experience: sentences.length
      ? [{ title: '', company: '', location: '', startDate: '', endDate: '', relevance: 5, bullets: sentences.map((s) => ({ text: s, evidence: [s] })) }]
      : [],
    education: [],
    skills: [],
    questions: [
      { section: 'experience', itemIndex: sentences.length ? 0 : null, question: 'What was your job title and company for this experience, and when did you work there?' },
      { section: 'summary', itemIndex: null, question: 'In one or two sentences, what are you strongest at for this role?' },
    ],
  };
}

function fakeSectionUpdate(message: string, schema: Record<string, unknown>) {
  const answer = tag(message, 'answer');
  const current = JSON.parse(tag(message, 'current_section') || 'null');
  const key = Object.keys((schema as { properties: Record<string, unknown> }).properties)[0]!;
  const claim = { text: answer, evidence: [answer] };
  switch (key) {
    case 'summary':
      return { summary: { text: [current, answer].filter(Boolean).join(' '), evidence: [answer] } };
    case 'contact':
      return { contact: current };
    case 'skills':
      return { skills: current };
    case 'newItems':
      return { newItems: [] };
    default: {
      const bulletsKey = 'bullets' in current ? 'bullets' : 'details';
      return { item: { ...current, relevance: 5, [bulletsKey]: [...current[bulletsKey].map((t: string) => ({ text: t, evidence: [t] })), claim] } };
    }
  }
}
