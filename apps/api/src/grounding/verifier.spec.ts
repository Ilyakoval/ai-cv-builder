import { CvDraftSchema } from '../generation/pipeline/draft';
import { Corpus, extractHardTerms, findUnsupportedTerms, isValidEvidence } from './corpus';
import { createContext, verifyDraft } from './verifier';

const SOURCE = `
Jane Doe — jane.doe@example.com, +380 67 123 45 67, Kyiv, Ukraine
github.com/janedoe

Backend Developer at Acme Corp (2019-03 – Present)
- Built payment service in Node.js and PostgreSQL handling 2,000 requests per second.
- Reduced cloud costs by 30% by moving batch jobs to AWS Lambda.
- Mentored two junior developers.

Education: Kyiv Polytechnic Institute, BSc Computer Science, 2015 – 2019.
Skills: TypeScript, Node.js, PostgreSQL, Docker, AWS.
`;

const corpus = new Corpus(SOURCE);

describe('Corpus helpers', () => {
  it('detects numbers and proper nouns as hard terms', () => {
    const { numbers, terms } = extractHardTerms('Led migration to Kubernetes, cutting latency by 45% for PostgreSQL.');
    expect(numbers).toEqual(['45']);
    expect(terms).toEqual(expect.arrayContaining(['Kubernetes', 'PostgreSQL']));
    expect(terms).not.toContain('Led'); // sentence-initial capital is not a fact
  });

  it('accepts reformatted numbers and spelled-out small numbers', () => {
    expect(findUnsupportedTerms('Handled 2000 requests per second', corpus)).toEqual([]);
    expect(findUnsupportedTerms('Mentored 2 junior developers', corpus)).toEqual([]);
    expect(findUnsupportedTerms('Mentored 3 junior developers', corpus)).toEqual(['3']);
  });

  it('tolerates plural/singular variation of terms', () => {
    expect(findUnsupportedTerms('Designed payment APIs on AWS', new Corpus('Designed the payment API on AWS'))).toEqual([]);
  });

  it('flags invented technologies and metrics', () => {
    expect(findUnsupportedTerms('Cut costs by 45% using Kubernetes', corpus)).toEqual(['45', 'Kubernetes']);
  });

  it('validates evidence quotes with tolerance for punctuation drift only', () => {
    expect(isValidEvidence('Built payment service in Node.js and PostgreSQL', corpus)).toBe(true);
    expect(isValidEvidence('built payment service in node js, and postgresql', corpus)).toBe(true);
    expect(isValidEvidence('Designed the company-wide data platform', corpus)).toBe(false);
    expect(isValidEvidence('', corpus)).toBe(false);
  });
});

describe('verifyDraft', () => {
  const draft = CvDraftSchema.parse({
    contact: {
      fullName: 'Jane Doe',
      email: 'jane.doe@example.com',
      phone: '+380671234567',
      location: 'Kyiv, Ukraine',
      links: [
        { label: 'GitHub', url: 'https://github.com/janedoe' },
        { label: 'LinkedIn', url: 'https://linkedin.com/in/janedoe' },
      ],
    },
    summary: {
      text: 'Backend Developer with Node.js and AWS experience, targeting a Senior Backend Engineer role. Holds an AWS Solutions Architect certification.',
      evidence: [],
    },
    experience: [
      {
        title: 'Backend Developer',
        company: 'Acme Corp',
        location: '',
        startDate: '2019-03',
        endDate: 'Present',
        relevance: 9,
        bullets: [
          { text: 'Built a Node.js and PostgreSQL payment service handling 2,000 requests per second.', evidence: ['Built payment service in Node.js and PostgreSQL handling 2,000 requests per second.'] },
          { text: 'Cut cloud costs by 30% by moving batch jobs to AWS Lambda.', evidence: ['Reduced cloud costs by 30%'] },
          { text: 'Introduced Kubernetes, improving deploy speed by 50%.', evidence: ['Built payment service'] },
          { text: 'Improved team culture.', evidence: [] },
        ],
      },
      {
        title: 'Tech Lead',
        company: 'Globex',
        location: '',
        startDate: '2017',
        endDate: '2019',
        relevance: 8,
        bullets: [{ text: 'Led a team.', evidence: ['Led a team'] }],
      },
    ],
    education: [
      { institution: 'Kyiv Polytechnic Institute', degree: 'BSc', field: 'Computer Science', startDate: '2015', endDate: '2019', details: [] },
    ],
    skills: [{ name: 'Backend', items: ['TypeScript', 'Node.js', 'Kubernetes', 'PostgreSQL', 'postgresql'] }],
    questions: [],
  });

  const result = verifyDraft(draft, createContext(SOURCE, 'Senior Backend Engineer'));

  it('keeps grounded content untouched', () => {
    expect(result.draft.contact).toMatchObject({ fullName: 'Jane Doe', email: 'jane.doe@example.com', phone: '+380671234567' });
    expect(result.draft.experience[0]!.bullets.map((b) => b.text)).toEqual([
      'Built a Node.js and PostgreSQL payment service handling 2,000 requests per second.',
      'Cut cloud costs by 30% by moving batch jobs to AWS Lambda.',
    ]);
    expect(result.draft.education).toHaveLength(1);
  });

  it('drops a link that is not in the source', () => {
    expect(result.draft.contact.links.map((l) => l.label)).toEqual(['GitHub']);
  });

  it('drops bullets with invented metrics/technologies or without evidence', () => {
    const removedTexts = result.removals.map((r) => r.text);
    expect(removedTexts).toContain('Introduced Kubernetes, improving deploy speed by 50%.');
    expect(removedTexts).toContain('Improved team culture.');
  });

  it('drops a whole job whose employer does not exist in the source', () => {
    expect(result.draft.experience.map((e) => e.company)).toEqual(['Acme Corp']);
    expect(result.experienceIndexMap).toEqual([0]);
    expect(result.removals).toContainEqual(expect.objectContaining({ section: 'experience', itemIndex: 1 }));
  });

  it('lets the summary name the target role but strips invented credentials', () => {
    expect(result.draft.summary.text).toBe(
      'Backend Developer with Node.js and AWS experience, targeting a Senior Backend Engineer role.',
    );
    expect(result.removals).toContainEqual(expect.objectContaining({ section: 'summary', text: expect.stringContaining('Solutions Architect') }));
  });

  it('keeps only skills named in the source, de-duplicated', () => {
    expect(result.draft.skills).toEqual([{ name: 'Backend', items: ['TypeScript', 'Node.js', 'PostgreSQL'] }]);
  });
});
