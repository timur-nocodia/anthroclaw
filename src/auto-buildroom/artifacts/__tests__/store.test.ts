import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeBuildroomStorage } from '../../storage/init.js';
import { FileArtifactStore } from '../store.js';
import type { BuildroomArtifact, BuildroomArtifactType } from '../model.js';

describe('FileArtifactStore', () => {
  let root: string;
  let store: FileArtifactStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-artifact-store-'));
    initializeBuildroomStorage({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      operatorId: 'cli:user:local-operator',
    });
    store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes and reads an artifact with computed content hash', () => {
    const written = store.writeArtifact(baseArtifact('research_20260512_docs', 'research_packet'));

    expect(written.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(store.hasArtifact(written.id)).toBe(true);
    expect(store.readArtifact(written.id)).toMatchObject({
      id: written.id,
      type: 'research_packet',
      contentHash: written.contentHash,
    });

    const raw = readFileSync(
      join(root, '.anthroclaw', 'auto-buildroom', 'rooms', 'anthroclaw-core', 'buildroom', 'research', `${written.id}.json`),
      'utf8',
    );
    expect(raw).toContain('"contentHash": "sha256:');
  });

  it('rejects a child artifact when a parent receipt is missing', () => {
    const child = baseArtifact('idea_20260512_docs', 'idea_contract');
    child.parentIds = ['research_missing'];

    expect(() => store.writeArtifact(child)).toThrow(/Missing parent artifact/);
  });

  it('allows a child artifact when its parent exists', () => {
    const parent = store.writeArtifact(baseArtifact('research_20260512_docs', 'research_packet'));
    const child = baseArtifact('idea_20260512_docs', 'idea_contract');
    child.parentIds = [parent.id];

    const written = store.writeArtifact(child);

    expect(written.parentIds).toEqual([parent.id]);
    expect(store.readArtifact(written.id).parentIds).toEqual([parent.id]);
  });

  it('lists artifacts by type', () => {
    store.writeArtifact(baseArtifact('research_20260512_docs', 'research_packet'));
    store.writeArtifact(baseArtifact('review_20260512_docs', 'main_review'));

    expect(store.listArtifacts('main_review').map((artifact) => artifact.id)).toEqual([
      'review_20260512_docs',
    ]);
    expect(store.listArtifacts().map((artifact) => artifact.id).sort()).toEqual([
      'research_20260512_docs',
      'review_20260512_docs',
    ]);
  });

  function baseArtifact(id: string, type: BuildroomArtifactType): BuildroomArtifact {
    return {
      id,
      type,
      schemaVersion: 'auto-buildroom/v1',
      status: 'completed',
      createdAt: '2026-05-12T00:00:00.000Z',
      producer: { role: 'research', runId: `run_${id}` },
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
      payload: { title: id },
    };
  }
});
