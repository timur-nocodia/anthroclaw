import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runExtraction,
  sanitizeMediaForLLM,
  sanitizeToolArgsForLLM,
  type ExtractionDeps,
  type RunSubagentFn,
} from '../src/extraction.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(
  runSubagent: RunSubagentFn,
  extractionDir: string,
  overrides: Partial<ExtractionDeps> = {}
): ExtractionDeps {
  return {
    runSubagent,
    extractionDir,
    logger: {
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
    },
    ...overrides,
  };
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── runExtraction ────────────────────────────────────────────────────────────

describe('runExtraction', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'extraction-test-'));
  });

  it('calls runSubagent with the extraction system-prompt', async () => {
    const runSubagent = vi.fn(async () => '- Decision: use TypeScript');
    const deps = makeDeps(runSubagent, tmpDir);

    await runExtraction(deps, 'We decided to use TypeScript for the project.');

    expect(runSubagent).toHaveBeenCalledOnce();
    const callArg = runSubagent.mock.calls[0][0];
    expect(callArg).toHaveProperty('prompt');
    expect(callArg).toHaveProperty('systemPrompt');
    // System prompt must mention extraction
    expect(callArg.systemPrompt).toMatch(/extract|decision|findings/i);
  });

  it('writes result to today YYYY-MM-DD.md file', async () => {
    const runSubagent = vi.fn(async () => '- Decision: ship it');
    const deps = makeDeps(runSubagent, tmpDir);

    await runExtraction(deps, 'We decided to ship the feature.');

    const file = join(tmpDir, `${todayUTC()}.md`);
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('- Decision: ship it');
  });

  it('appends to the same file on multiple calls in the same day', async () => {
    const runSubagent = vi.fn()
      .mockResolvedValueOnce('- Decision: first call')
      .mockResolvedValueOnce('- Decision: second call');
    const deps = makeDeps(runSubagent, tmpDir);

    await runExtraction(deps, 'First segment.');
    await runExtraction(deps, 'Second segment.');

    const file = join(tmpDir, `${todayUTC()}.md`);
    const content = readFileSync(file, 'utf8');
    expect(content).toContain('- Decision: first call');
    expect(content).toContain('- Decision: second call');
    // Must have two separate blocks — timestamps appear twice
    const matches = content.match(/---/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT throw when runSubagent throws', async () => {
    const runSubagent = vi.fn(async () => {
      throw new Error('subagent exploded');
    });
    const deps = makeDeps(runSubagent, tmpDir);

    await expect(runExtraction(deps, 'some text')).resolves.toBeUndefined();
    expect(deps.logger.warn).toHaveBeenCalledOnce();
  });

  it('logs warn and does not throw on subagent rejection', async () => {
    const runSubagent = vi.fn().mockRejectedValue(new Error('timeout'));
    const logger = { warn: vi.fn(), debug: vi.fn(), info: vi.fn() };
    const deps = makeDeps(runSubagent, tmpDir, { logger });

    await expect(runExtraction(deps, 'hello world')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does NOT write a file when subagent returns empty string', async () => {
    const runSubagent = vi.fn(async () => '');
    const deps = makeDeps(runSubagent, tmpDir);

    await runExtraction(deps, 'some content');

    const file = join(tmpDir, `${todayUTC()}.md`);
    expect(existsSync(file)).toBe(false);
    expect(deps.logger.debug).toHaveBeenCalled();
  });

  it('does NOT write a file when subagent returns whitespace-only string', async () => {
    const runSubagent = vi.fn(async () => '   \n  ');
    const deps = makeDeps(runSubagent, tmpDir);

    await runExtraction(deps, 'some content');

    const file = join(tmpDir, `${todayUTC()}.md`);
    expect(existsSync(file)).toBe(false);
  });

  it('creates extractionDir if it does not exist', async () => {
    const nonExistent = join(tmpDir, 'nested', 'extraction');
    const runSubagent = vi.fn(async () => '- fact: created');
    const deps = makeDeps(runSubagent, nonExistent);

    await runExtraction(deps, 'some content');

    const file = join(nonExistent, `${todayUTC()}.md`);
    expect(existsSync(file)).toBe(true);
  });

  it('passes sourceText through sanitizeMediaForLLM before calling runSubagent', async () => {
    const b64 = 'A'.repeat(50);
    const sourceWithMedia = `Look at this: data:image/png;base64,${b64} end.`;
    const runSubagent = vi.fn(async () => '- fact: media sanitized');
    const deps = makeDeps(runSubagent, tmpDir);

    await runExtraction(deps, sourceWithMedia);

    const callArg = runSubagent.mock.calls[0][0];
    expect(callArg.prompt).not.toContain('base64,');
    expect(callArg.prompt).toContain('[Media attachment]');
  });

  it('passes timeoutMs through to runSubagent', async () => {
    const runSubagent = vi.fn(async () => '- ok');
    const deps = makeDeps(runSubagent, tmpDir, { timeoutMs: 30_000 });

    await runExtraction(deps, 'text');

    expect(runSubagent.mock.calls[0][0].timeoutMs).toBe(30_000);
  });
});

// ─── sanitizeMediaForLLM ──────────────────────────────────────────────────────

describe('sanitizeMediaForLLM', () => {
  it('replaces data:image/png;base64,... with [Media attachment]', () => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const input = `Here is an image: data:image/png;base64,${b64} and some text after.`;
    const result = sanitizeMediaForLLM(input);
    expect(result).not.toContain('base64,');
    expect(result).toContain('[Media attachment]');
    expect(result).toContain('and some text after.');
  });

  it('handles multiple media blobs in the same string', () => {
    const b64 = 'abc123=';
    const input = `img1: data:image/jpeg;base64,${b64} img2: data:audio/mp3;base64,${b64}`;
    const result = sanitizeMediaForLLM(input);
    const matches = result.match(/\[Media attachment\]/g) ?? [];
    expect(matches.length).toBe(2);
    expect(result).not.toContain('base64,');
  });

  it('does not change strings with no media', () => {
    const input = 'Hello world, nothing here to sanitize.';
    expect(sanitizeMediaForLLM(input)).toBe(input);
  });

  it('handles video and audio mime types', () => {
    const input = 'data:video/mp4;base64,AAAA data:audio/wav;base64,BBBB';
    const result = sanitizeMediaForLLM(input);
    expect(result).not.toContain('base64,');
    const matches = result.match(/\[Media attachment\]/g) ?? [];
    expect(matches.length).toBe(2);
  });
});

// ─── sanitizeToolArgsForLLM ───────────────────────────────────────────────────

describe('sanitizeToolArgsForLLM', () => {
  it('replaces long base64 string (≥200 chars) with <binary-omitted: N chars>', () => {
    const longB64 = 'A'.repeat(250);
    const json = JSON.stringify({ file_data: longB64, name: 'test' });
    const result = sanitizeToolArgsForLLM(json);
    expect(result).not.toContain(longB64);
    expect(result).toContain('<binary-omitted: 250 chars>');
    expect(result).toContain('"test"');
  });

  it('does not touch short strings (<200 chars)', () => {
    const shortB64 = 'A'.repeat(100);
    const json = JSON.stringify({ data: shortB64 });
    const result = sanitizeToolArgsForLLM(json);
    expect(result).toContain(shortB64);
    expect(result).not.toContain('binary-omitted');
  });

  it('preserves non-base64 JSON content', () => {
    const json = JSON.stringify({ action: 'read_file', path: '/tmp/foo.txt', line: 42 });
    const result = sanitizeToolArgsForLLM(json);
    expect(result).toContain('read_file');
    expect(result).toContain('/tmp/foo.txt');
    expect(result).toContain('42');
  });

  it('handles exactly 200-char string as boundary (should replace)', () => {
    const b64 = 'B'.repeat(200);
    const json = JSON.stringify({ data: b64 });
    const result = sanitizeToolArgsForLLM(json);
    expect(result).toContain('<binary-omitted: 200 chars>');
  });

  it('handles exactly 199-char string as boundary (should NOT replace)', () => {
    const b64 = 'C'.repeat(199);
    const json = JSON.stringify({ data: b64 });
    const result = sanitizeToolArgsForLLM(json);
    expect(result).not.toContain('binary-omitted');
    expect(result).toContain(b64);
  });
});
