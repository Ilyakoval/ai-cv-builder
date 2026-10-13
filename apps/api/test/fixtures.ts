export const SOURCE_TEXT = `Jane Doe — jane.doe@example.com — Kyiv
Backend Developer at Acme Corp, 2019 – 2024.
Built the payments API in Node.js and PostgreSQL. Reduced p95 latency by 30%.
Education: Kyiv Polytechnic Institute, BSc Computer Science, 2015 – 2019.`;

export function goodDraft() {
  return {
    contact: { fullName: 'Jane Doe', email: 'jane.doe@example.com', phone: '', location: 'Kyiv', links: [] },
    summary: { text: 'Backend Developer with Node.js and PostgreSQL experience.', evidence: ['Backend Developer'] },
    experience: [
      {
        title: 'Backend Developer',
        company: 'Acme Corp',
        location: '',
        startDate: '2019',
        endDate: '2024',
        relevance: 9,
        bullets: [
          { text: 'Built the payments API in Node.js and PostgreSQL.', evidence: ['Built the payments API in Node.js and PostgreSQL'] },
          { text: 'Reduced p95 latency by 30%.', evidence: ['Reduced p95 latency by 30%'] },
          // Hallucinated: must be removed by the verifier (and the repair pass keeps it, see tests).
          { text: 'Led a team of 8 engineers.', evidence: ['Led a team'] },
        ],
      },
    ],
    education: [
      { institution: 'Kyiv Polytechnic Institute', degree: 'BSc', field: 'Computer Science', startDate: '2015', endDate: '2019', details: [] },
    ],
    skills: [{ name: 'Backend', items: ['Node.js', 'PostgreSQL', 'Kubernetes'] }],
    questions: [{ section: 'experience', itemIndex: 0, question: 'How many requests per day does the payments API handle?' }],
  };
}
