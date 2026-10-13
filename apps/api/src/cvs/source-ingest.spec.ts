import { emptyCvDocument } from '@cvb/shared';
import { renderCvPdf } from '../pdf/cv-pdf';
import { extractPdfText, normalizeExtractedText } from './source-ingest';

describe('PDF round trip', () => {
  const doc = {
    ...emptyCvDocument(),
    contact: { fullName: 'Олена Коваль', email: 'olena@example.com', phone: '', location: 'Миколаїв', links: [{ label: 'GitHub', url: 'https://github.com/olena' }] },
    summary: 'Backend engineer focused on payments and reliability, with hands-on Node.js and PostgreSQL experience.',
    experience: [{ id: 'exp_1', title: 'Backend Developer', company: 'Acme', location: '', startDate: '2019', endDate: 'Present', bullets: ['Built the billing API.'] }],
  };

  it('renders an A4 PDF whose text (incl. Cyrillic) is selectable/extractable', async () => {
    const pdf = await renderCvPdf(doc, 'CV');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.2\d+ 841\.8\d+\]/); // A4 in points
    const text = await extractPdfText(pdf);
    expect(text).toContain('Олена Коваль');
    expect(text).toContain('Built the billing API.');
  });
});

describe('extractPdfText — untrusted input', () => {
  it('rejects files that are not PDFs regardless of their name/MIME', async () => {
    await expect(extractPdfText(Buffer.from('<html>not a pdf</html>'))).rejects.toThrow('not a PDF');
  });

  it('rejects corrupted PDFs with a friendly message', async () => {
    await expect(extractPdfText(Buffer.from('%PDF-1.7\n garbage'))).rejects.toThrow(/could not read this PDF|no selectable text/);
  });

  it('rejects PDFs with no text layer', async () => {
    const pdf = await renderCvPdf(emptyCvDocument(), 'x');
    await expect(extractPdfText(pdf)).rejects.toThrow('no selectable text');
  });
});

describe('normalizeExtractedText', () => {
  it('strips control chars and collapses whitespace', () => {
    expect(normalizeExtractedText('a\u0000b  \t c\r\n\n\n\nd')).toBe('ab c\n\nd');
  });
});
