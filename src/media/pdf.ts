import { readFileSync } from 'node:fs';
import { logger } from '../logger.js';

/**
 * Extract text from a PDF file.
 * Uses a lightweight approach: parse the raw PDF stream for text objects.
 * No external dependencies required.
 */
export function extractPdfText(filePath: string): string | null {
  try {
    const buffer = readFileSync(filePath);
    const raw = buffer.toString('latin1');

    const textParts: string[] = [];

    // Extract text between BT...ET blocks (PDF text objects)
    const btEtRegex = /BT\s([\s\S]*?)ET/g;
    let btMatch: RegExpExecArray | null;

    while ((btMatch = btEtRegex.exec(raw)) !== null) {
      const block = btMatch[1];

      // Match text-showing operators: Tj, TJ, ', "
      // Tj: (text) Tj
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        textParts.push(decodePdfString(tjMatch[1]));
      }

      // TJ: [(text) num (text) ...] TJ
      const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
      let tjArrMatch: RegExpExecArray | null;
      while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
        const inner = tjArrMatch[1];
        const stringRegex = /\(([^)]*)\)/g;
        let strMatch: RegExpExecArray | null;
        while ((strMatch = stringRegex.exec(inner)) !== null) {
          textParts.push(decodePdfString(strMatch[1]));
        }
      }
    }

    // Also try extracting from stream objects with /Filter /FlateDecode
    // This handles compressed content streams - skip for now, raw text is a good start

    if (textParts.length === 0) {
      // Fallback: try extracting any readable strings from the PDF
      const readableRegex = /\(([A-Za-z0-9 .,;:!?'"()\-/\\@#$%^&*+=\[\]{}|~`<>]{4,})\)/g;
      let readMatch: RegExpExecArray | null;
      while ((readMatch = readableRegex.exec(raw)) !== null) {
        textParts.push(decodePdfString(readMatch[1]));
      }
    }

    const text = textParts.join(' ').replace(/\s+/g, ' ').trim();

    if (text.length === 0) {
      logger.debug({ filePath }, 'No extractable text found in PDF (may be image-based or compressed)');
      return null;
    }

    return text;
  } catch (err) {
    logger.error({ err, filePath }, 'PDF text extraction failed');
    return null;
  }
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}
