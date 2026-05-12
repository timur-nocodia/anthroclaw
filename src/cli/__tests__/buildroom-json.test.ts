import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../../auto-buildroom/artifacts/store.js';
import type { BuildroomArtifact } from '../../auto-buildroom/artifacts/model.js';
import { runBuildroomCli } from '../buildroom.js';

describe('buildroom CLI JSON output', () => {
  let root: string;
  const out: string[] = [];
  const err: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-cli-json-'));
    out.length = 0;
    err.length = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('renders status as stable JSON for automation', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    out.length = 0;

    await expect(run(['status', '--root', root, '--json'])).resolves.toBe(0);

    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toMatchObject({
      ok: true,
      command: 'status',
      roomId: 'anthroclaw-core',
      state: {
        roomState: 'idle',
        mode: 'manual_approval',
        paused: false,
        killSwitchActive: false,
        latestTrust: 'none',
        counts: {
          pendingApprovals: 0,
          approvedNotBuilt: 0,
          activeBuilds: 0,
          qaPending: 0,
          unresolvedErrors: 0,
        },
      },
      nextActions: ['anthroclaw buildroom collect'],
    });
  });

  it('renders receipt inspection as JSON', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(artifact('research_20260512_docs', 'research_packet', {
      summary: 'Deterministic research packet',
    }));
    out.length = 0;

    await expect(run(['show', 'research_20260512_docs', '--root', root, '--json'])).resolves.toBe(0);

    expect(JSON.parse(out[0])).toMatchObject({
      ok: true,
      command: 'show',
      roomId: 'anthroclaw-core',
      artifact: {
        id: 'research_20260512_docs',
        type: 'research_packet',
        status: 'completed',
        room: { id: 'anthroclaw-core' },
      },
    });
  });

  it('renders trust reports as JSON without losing the human report body', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(artifact('trust_20260512_docs', 'trust_report', {
      trustState: 'watch',
      reasons: ['QA passed with notes.'],
    }));
    out.length = 0;

    await expect(run(['report', '--root', root, '--json'])).resolves.toBe(0);

    expect(JSON.parse(out[0])).toMatchObject({
      ok: true,
      command: 'report',
      roomId: 'anthroclaw-core',
      state: {
        trustState: 'watch',
      },
      artifacts: [
        {
          id: 'trust_20260512_docs',
          type: 'trust_report',
          status: 'completed',
        },
      ],
      report: expect.stringContaining('Trust: WATCH'),
    });
  });

  it('renders missing artifact errors as JSON on stderr', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    out.length = 0;
    err.length = 0;

    await expect(run(['show', 'missing_20260512_docs', '--root', root, '--json'])).resolves.toBe(5);

    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(JSON.parse(err[0])).toMatchObject({
      ok: false,
      command: 'show',
      roomId: 'anthroclaw-core',
      error: {
        code: 'missing_artifact',
        message: 'Artifact not found: missing_20260512_docs',
        nextActions: ['anthroclaw buildroom status'],
      },
    });
  });

  it('renders unknown command errors as JSON on stderr', async () => {
    await expect(run(['unknown-command', '--root', root, '--json'])).resolves.toBe(2);

    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(JSON.parse(err[0])).toMatchObject({
      ok: false,
      command: 'unknown-command',
      roomId: 'anthroclaw-core',
      error: {
        code: 'invalid_usage',
        message: 'Unknown command: unknown-command',
        nextActions: ['anthroclaw buildroom help'],
      },
    });
  });

  function artifact(
    id: string,
    type: BuildroomArtifact['type'],
    payload: Record<string, unknown>,
  ): BuildroomArtifact {
    return {
      id,
      type,
      schemaVersion: 'auto-buildroom/v1',
      status: 'completed',
      createdAt: '2026-05-12T00:00:00.000Z',
      producer: { role: 'test', runId: `run_${id}` },
      room: { id: 'anthroclaw-core' },
      parentIds: [],
      inputRefs: [],
      outputRefs: [],
      runtimeRefs: [],
      traceId: `trace_${id}`,
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
        redactedFields: [],
      },
      contentHash: '',
      payload,
    };
  }

  function run(argv: string[]): Promise<number> {
    return runBuildroomCli(argv, {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    });
  }
});
