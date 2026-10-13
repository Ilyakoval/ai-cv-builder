import { emptyCvDocument } from '@cvb/shared';
import { ScriptedLlm } from '../../../test/scripted-llm';
import { LlmOutputError } from '../../llm/llm.types';
import { CvPipeline } from './cv-pipeline';

const SOURCE = `Jane Doe, jane@example.com
Backend Developer at Acme Corp, 2019 - 2024.
Built the billing API in Node.js. Cut response times by 40%.`;

const draft = (bullets: { text: string; evidence: string[] }[]) => ({
  contact: { fullName: 'Jane Doe', email: 'jane@example.com', phone: '', location: '', links: [] },
  summary: { text: 'Backend Developer focused on APIs.', evidence: ['Backend Developer'] },
  experience: [{ title: 'Backend Developer', company: 'Acme Corp', location: '', startDate: '2019', endDate: '2024', relevance: 8, bullets }],
  education: [],
  skills: [{ name: 'Tech', items: ['Node.js'] }],
  questions: [],
});

describe('CvPipeline.generate', () => {
  it('runs a repair pass when the draft contains unsupported claims, and keeps only verified content', async () => {
    const llm = new ScriptedLlm().push(
      draft([
        { text: 'Built the billing API in Node.js.', evidence: ['Built the billing API in Node.js'] },
        { text: 'Cut response times by 70% with Redis.', evidence: ['Cut response times'] },
      ]),
      // Repair still keeps one bad claim; the final verification must remove it.
      draft([
        { text: 'Built the billing API in Node.js.', evidence: ['Built the billing API in Node.js'] },
        { text: 'Cut response times by 40%.', evidence: ['Cut response times by 40%'] },
        { text: 'Led a team of 5.', evidence: ['Led a team'] },
      ]),
    );
    const result = await new CvPipeline(llm).generate({ targetRole: 'Senior Backend Engineer', sourceText: SOURCE, answers: [] });

    expect(llm.calls.map((c) => c.purpose)).toEqual(['generate', 'repair']);
    expect(llm.calls[1]!.user).toContain('70%');
    expect(result.document.experience[0]!.bullets).toEqual(['Built the billing API in Node.js.', 'Cut response times by 40%.']);
    expect(result.removals.map((r) => r.text)).toContain('Led a team of 5.');
  });

  it('skips the repair pass when everything is grounded', async () => {
    const llm = new ScriptedLlm().push(draft([{ text: 'Built the billing API in Node.js.', evidence: ['Built the billing API'] }]));
    await new CvPipeline(llm).generate({ targetRole: 'Engineer', sourceText: SOURCE, answers: [] });
    expect(llm.calls).toHaveLength(1);
  });

  it('retries once on structurally invalid output, then fails with LlmOutputError', async () => {
    const llm = new ScriptedLlm().push({ contact: 'nope' }, { experience: 42 });
    await expect(new CvPipeline(llm).generate({ targetRole: 'Engineer', sourceText: SOURCE, answers: [] })).rejects.toBeInstanceOf(LlmOutputError);
    expect(llm.calls[1]!.user).toContain('invalid structure');
  });

  it('treats candidate answers as grounding', async () => {
    const llm = new ScriptedLlm().push(
      draft([{ text: 'Migrated billing to Kafka, processing 1M events daily.', evidence: ['migrated billing to Kafka, 1M events a day'] }]),
    );
    const result = await new CvPipeline(llm).generate({
      targetRole: 'Engineer',
      sourceText: SOURCE,
      answers: [{ question: 'Biggest project?', answer: 'I migrated billing to Kafka, 1M events a day.' }],
    });
    expect(result.document.experience[0]!.bullets).toHaveLength(1);
    expect(llm.calls[0]!.user).toContain('<candidate_answers>');
  });
});

describe('CvPipeline.applyAnswer', () => {
  const doc = {
    ...emptyCvDocument(),
    experience: [
      // "Mentored interns" was typed by the user in the editor — it is not in SOURCE.
      { id: 'exp_1', title: 'Backend Developer', company: 'Acme Corp', location: '', startDate: '2019', endDate: '2024', bullets: ['Built the billing API in Node.js.', 'Mentored interns.'] },
    ],
  };

  it('updates one item, keeps the user\'s own edits, and rejects invented facts', async () => {
    const llm = new ScriptedLlm().push({
      item: {
        ...doc.experience[0],
        relevance: 8,
        bullets: [
          { text: 'Built the billing API in Node.js, serving 3 regions.', evidence: ['serves 3 regions'] },
          { text: 'Mentored interns.', evidence: ['Mentored interns.'] },
          { text: 'Introduced GraphQL.', evidence: ['GraphQL'] },
        ],
      },
    });
    const { change, removals } = await new CvPipeline(llm).applyAnswer({
      targetRole: 'Engineer',
      sourceText: SOURCE,
      answers: [],
      document: doc,
      section: 'experience',
      itemId: 'exp_1',
      question: 'How large was the billing API?',
      answer: 'It serves 3 regions.',
    });
    expect(change).toMatchObject({ kind: 'replace-item', itemId: 'exp_1' });
    const item = change.kind === 'replace-item' && change.section === 'experience' ? change.item : null;
    expect(item?.bullets).toEqual(['Built the billing API in Node.js, serving 3 regions.', 'Mentored interns.']);
    expect(removals.map((r) => r.text)).toEqual(['Introduced GraphQL.']);
  });

  it('fails cleanly when the referenced item was deleted', async () => {
    const llm = new ScriptedLlm();
    await expect(
      new CvPipeline(llm).applyAnswer({ targetRole: 'x', sourceText: SOURCE, answers: [], document: doc, section: 'experience', itemId: 'gone', question: 'q', answer: 'a' }),
    ).rejects.toThrow('no longer exists');
    expect(llm.calls).toHaveLength(0);
  });
});
