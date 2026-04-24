import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractPdfText } from '../../src/media/pdf.js';

describe('extractPdfText', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pdf-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for non-existent file', () => {
    const result = extractPdfText('/tmp/nonexistent.pdf');
    expect(result).toBeNull();
  });

  it('returns null for empty file', () => {
    const filePath = join(tmpDir, 'empty.pdf');
    writeFileSync(filePath, '', 'utf-8');
    const result = extractPdfText(filePath);
    expect(result).toBeNull();
  });

  it('extracts text from a minimal PDF with Tj operator', () => {
    // Minimal PDF content with a text object
    const pdfContent = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Contents 4 0 R/Parent 2 0 R>>endobj
4 0 obj<</Length 44>>
stream
BT
/F1 12 Tf
100 700 Td
(Hello World) Tj
ET
endstream
endobj
xref
0 5
trailer<</Size 5/Root 1 0 R>>
startxref
0
%%EOF`;

    const filePath = join(tmpDir, 'test.pdf');
    writeFileSync(filePath, pdfContent, 'latin1');

    const result = extractPdfText(filePath);
    expect(result).toBe('Hello World');
  });

  it('extracts text from TJ array operator', () => {
    const pdfContent = `%PDF-1.4
BT
[(Hello) 100 (World)] TJ
ET`;

    const filePath = join(tmpDir, 'array.pdf');
    writeFileSync(filePath, pdfContent, 'latin1');

    const result = extractPdfText(filePath);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });

  it('decodes escape sequences', () => {
    const pdfContent = `%PDF-1.4
BT
(Hello\\nWorld) Tj
ET`;

    const filePath = join(tmpDir, 'escaped.pdf');
    writeFileSync(filePath, pdfContent, 'latin1');

    const result = extractPdfText(filePath);
    expect(result).toContain('Hello');
    expect(result).toContain('World');
  });
});
