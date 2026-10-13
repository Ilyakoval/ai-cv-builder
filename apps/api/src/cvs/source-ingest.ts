import { PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { PDF_MAX_BYTES, PDF_MAX_PAGES, SOURCE_TEXT_MAX, SOURCE_TEXT_MIN } from '@cvb/shared';
import { extractText, getDocumentProxy } from 'unpdf';

const PDF_PARSE_TIMEOUT_MS = 10_000;

/**
 * Turns an uploaded PDF into plain text. The file is untrusted: we check the
 * magic bytes (not the client-supplied MIME type), cap size and page count,
 * and bound parse time. Only the extracted text is persisted — never the file.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length > PDF_MAX_BYTES) throw new PayloadTooLargeException('PDF is too large (max 5 MB)');
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new UnprocessableEntityException('This file is not a PDF');
  }

  let text: string;
  try {
    text = await withTimeout(
      (async () => {
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        try {
          if (pdf.numPages > PDF_MAX_PAGES) {
            throw new UnprocessableEntityException(`PDF has too many pages (max ${PDF_MAX_PAGES})`);
          }
          const { text } = await extractText(pdf, { mergePages: false });
          return (text as string[]).join('\n\n');
        } finally {
          await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
        }
      })(),
      PDF_PARSE_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof UnprocessableEntityException) throw err;
    throw new UnprocessableEntityException('We could not read this PDF. Try exporting it again, or paste the text instead.');
  }

  const cleaned = normalizeExtractedText(text);
  if (cleaned.length < SOURCE_TEXT_MIN) {
    throw new UnprocessableEntityException(
      'This PDF has no selectable text (it may be a scanned image). Paste your CV as text instead.',
    );
  }
  return cleaned.slice(0, SOURCE_TEXT_MAX);
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('PDF parsing timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
