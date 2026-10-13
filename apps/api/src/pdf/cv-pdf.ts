import type { CvDocument } from '@cvb/shared';
import PdfPrinter from 'pdfmake';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

// pdfmake ships Roboto (incl. Cyrillic) as base64 in its browser VFS bundle;
// reuse it server-side so the container needs no system fonts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfs: Record<string, string> = require('pdfmake/build/vfs_fonts.js');
const font = (name: string) => Buffer.from(vfs[name]!, 'base64');

const printer = new PdfPrinter({
  Roboto: {
    normal: font('Roboto-Regular.ttf'),
    bold: font('Roboto-Medium.ttf'),
    italics: font('Roboto-Italic.ttf'),
    bolditalics: font('Roboto-MediumItalic.ttf'),
  },
});

const ACCENT = '#1f3a5f';
const MUTED = '#5b6573';

const range = (a: string, b: string) => [a, b].filter(Boolean).join(' – ');

function sectionTitle(text: string): Content[] {
  return [
    { text: text.toUpperCase(), style: 'section' },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: ACCENT }], margin: [0, 2, 0, 6] },
  ];
}

/**
 * Builds the CV as real text (not an image of HTML), so the PDF is A4,
 * searchable, selectable and ATS-friendly. Pure function of the document;
 * the only input is already-validated, sanitised data.
 */
export function buildCvDefinition(doc: CvDocument, title: string): TDocumentDefinitions {
  const c = doc.contact;
  const contactLine = [c.email, c.phone, c.location].filter(Boolean).join('  ·  ');
  const content: Content[] = [];

  content.push({ text: c.fullName || title, style: 'name' });
  if (contactLine) content.push({ text: contactLine, style: 'contact' });
  if (c.links.length) {
    content.push({
      text: c.links.flatMap((l, i) => [
        ...(i ? [{ text: '  ·  ' }] : []),
        { text: l.label || l.url, link: l.url, color: ACCENT },
      ]),
      style: 'contact',
    });
  }

  if (doc.summary) {
    content.push(...sectionTitle('Summary'), { text: doc.summary, style: 'body', margin: [0, 0, 0, 4] });
  }

  if (doc.experience.length) {
    content.push(...sectionTitle('Experience'));
    for (const e of doc.experience) {
      content.push({
        columns: [
          { text: [{ text: e.title, bold: true }, e.company ? { text: `  ·  ${e.company}` } : ''], width: '*' },
          { text: range(e.startDate, e.endDate), width: 'auto', style: 'meta' },
        ],
        margin: [0, 4, 0, 1],
      });
      if (e.location) content.push({ text: e.location, fontSize: 9, color: MUTED });
      if (e.bullets.length) content.push({ ul: e.bullets, style: 'body', margin: [8, 2, 0, 4] });
    }
  }

  if (doc.education.length) {
    content.push(...sectionTitle('Education'));
    for (const e of doc.education) {
      const degree = [e.degree, e.field].filter(Boolean).join(', ');
      content.push({
        columns: [
          { text: [{ text: e.institution, bold: true }, degree ? { text: `  ·  ${degree}` } : ''], width: '*' },
          { text: range(e.startDate, e.endDate), width: 'auto', style: 'meta' },
        ],
        margin: [0, 4, 0, 1],
      });
      if (e.details.length) content.push({ ul: e.details, style: 'body', margin: [8, 2, 0, 4] });
    }
  }

  if (doc.skills.length) {
    content.push(...sectionTitle('Skills'));
    for (const g of doc.skills) {
      content.push({ text: [{ text: `${g.name}: `, bold: true }, g.items.join(', ')], style: 'body', margin: [0, 0, 0, 2] });
    }
  }

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    info: { title: c.fullName ? `${c.fullName} — CV` : title, creator: 'AI CV Builder' },
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25, color: '#1d232b' },
    styles: {
      name: { fontSize: 20, bold: true, color: ACCENT },
      contact: { fontSize: 9, color: MUTED, margin: [0, 2, 0, 0] },
      section: { fontSize: 10.5, bold: true, color: ACCENT, margin: [0, 12, 0, 0], characterSpacing: 0.6 },
      body: { fontSize: 10 },
      meta: { fontSize: 9, color: MUTED, alignment: 'right' },
    },
    content,
  };
}

export function renderCvPdf(doc: CvDocument, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(buildCvDefinition(doc, title));
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}
