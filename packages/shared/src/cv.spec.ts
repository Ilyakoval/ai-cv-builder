import { CvDocumentSchema, emptyCvDocument, normalizePhone, normalizeUrl, sanitizeText } from './cv';

describe('normalizeUrl', () => {
  it.each([
    ['github.com/jane', 'https://github.com/jane'],
    ['https://linkedin.com/in/jane', 'https://linkedin.com/in/jane'],
    ['mailto:jane@example.com', 'mailto:jane@example.com'],
    ['', ''],
  ])('accepts %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it.each(['javascript:alert(1)', 'data:text/html;base64,AAAA', 'file:///etc/passwd', 'localhost'])(
    'rejects %s',
    (input) => {
      expect(normalizeUrl(input)).toBeNull();
    },
  );
});

describe('sanitizeText', () => {
  it('strips control and bidi-override characters', () => {
    expect(sanitizeText('  Jane\u0000 ‮Doe​ ')).toBe('Jane Doe');
  });
});

describe('CvDocumentSchema', () => {
  it('accepts an empty document', () => {
    expect(CvDocumentSchema.parse(emptyCvDocument())).toEqual(emptyCvDocument());
  });

  it('rejects dangerous links and over-long fields', () => {
    const doc = emptyCvDocument();
    doc.contact.links = [{ label: 'x', url: 'javascript:alert(1)' }];
    doc.summary = 'a'.repeat(1501);
    const result = CvDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['contact.links.0.url', 'summary']));
  });

  it('flattens newlines in single-line fields', () => {
    const doc = emptyCvDocument();
    doc.contact.fullName = 'Jane\n  Doe';
    expect(CvDocumentSchema.parse(doc).contact.fullName).toBe('Jane Doe');
  });

  it('rejects a phone that does not look like a phone', () => {
    const doc = emptyCvDocument();
    doc.contact.phone = '2013-2017';
    const result = CvDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('contact.phone');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['+380 67 123 45 67', '+380 67 123 45 67'],
    ['(044) 123-45-67', '(044) 123-45-67'],
    ['+1.212.555.0100', '+1.212.555.0100'],
    ['', ''],
  ])('accepts %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    '2013-2017', // year range that looks digit-heavy
    '2013 – 2017',
    '123456', // fewer than 7 digits
    '+1234567890123456', // more than 15 digits
    'call me 0671234567', // letters mixed in
  ])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
