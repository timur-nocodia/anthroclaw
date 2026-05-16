import { describe, expect, it } from 'vitest';
import {
  extractLastJsonObject,
  renderPiSmokeSummary,
} from '../pi-smoke-summary.mjs';

describe('Pi smoke summary helper', () => {
  it('extracts the last structured JSON object from mixed smoke output', () => {
    const result = extractLastJsonObject([
      '> anthroclaw@1.0.0 smoke:pi-all',
      '{"status":"failed","runtime":"pi"}',
      'node warning with { braces }',
      '{"status":"passed","runtime":"pi","durationMs":42,"probes":{"auth":{"status":"passed","code":0}}}',
    ].join('\n'));

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      durationMs: 42,
      probes: {
        auth: {
          status: 'passed',
          code: 0,
        },
      },
    });
  });

  it('renders a compact Markdown status table', () => {
    const summary = renderPiSmokeSummary({
      status: 'failed',
      runtime: 'pi',
      durationMs: 100,
      probes: {
        auth: { status: 'passed', code: 0 },
        workspace: { status: 'failed', code: 1, error: 'tool | denied' },
        gateway: { status: 'skipped', code: 0, error: 'auth did not pass\nretry later' },
      },
    }, {
      exitCode: 1,
    });

    expect(summary).toContain('| status | failed |');
    expect(summary).toContain('| workspace | failed | 1 | tool \\| denied |');
    expect(summary).toContain('| gateway | skipped | 0 | auth did not pass<br>retry later |');
  });

  it('renders a failed summary when no JSON result was found', () => {
    expect(renderPiSmokeSummary(undefined, { exitCode: 1 })).toContain('No structured JSON result was found');
  });
});
