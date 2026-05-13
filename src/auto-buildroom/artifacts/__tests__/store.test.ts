import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeBuildroomStorage } from '../../storage/init.js';
import { FileArtifactStore } from '../store.js';
import { computeArtifactContentHash } from '../hash.js';
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

  it('does not read artifacts from a different room', () => {
    const otherStore = new FileArtifactStore({ projectRoot: root, roomId: 'other-room' });
    const otherArtifact = {
      ...baseArtifact('research_20260512_other', 'research_packet'),
      room: { id: 'other-room' },
    };
    otherStore.writeArtifact(otherArtifact);

    expect(store.hasArtifact(otherArtifact.id)).toBe(false);
    expect(() => store.readArtifact(otherArtifact.id)).toThrow(/Artifact not found/);
  });

  it('rejects writing an artifact whose room does not match the store room', () => {
    const artifact = {
      ...baseArtifact('research_20260512_wrong_room', 'research_packet'),
      room: { id: 'other-room' },
    };

    expect(() => store.writeArtifact(artifact)).toThrow(/Artifact room mismatch/);
    expect(store.hasArtifact(artifact.id)).toBe(false);
  });

  it('stores sanitized session summaries and handoff signals in their v0.1 locations', () => {
    const summary = store.writeArtifact(baseArtifact(
      'session-summary-20260512-001',
      'session_summary' as BuildroomArtifactType,
    ));
    const handoff = store.writeArtifact(baseArtifact(
      'handoff_20260512_docs',
      'handoff_signal' as BuildroomArtifactType,
    ));

    expect(store.pathForArtifact(summary)).toContain(
      join('buildroom', 'session-summaries', 'session-summary-20260512-001.json'),
    );
    expect(store.pathForArtifact(handoff)).toContain(
      join('buildroom', 'signals', 'handoff_20260512_docs.json'),
    );
  });

  it('rejects tampered artifact content when reading receipts', () => {
    const written = store.writeArtifact(baseArtifact('research_20260512_docs', 'research_packet'));
    const path = store.pathForArtifact(written);
    const tampered = JSON.parse(readFileSync(path, 'utf8')) as BuildroomArtifact;
    tampered.payload.title = 'tampered';
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');

    expect(() => store.readArtifact(written.id)).toThrow(/Artifact hash mismatch/);
    expect(() => store.listArtifacts('research_packet')).toThrow(/Artifact hash mismatch/);
  });

  it('rejects artifacts with unsupported schema versions even when content hash matches', () => {
    const written = store.writeArtifact(baseArtifact('research_20260512_docs', 'research_packet'));
    const path = store.pathForArtifact(written);
    const unsupported = {
      ...JSON.parse(readFileSync(path, 'utf8')) as BuildroomArtifact,
      schemaVersion: 'auto-buildroom/v999',
      contentHash: '',
    };
    unsupported.contentHash = computeArtifactContentHash(unsupported);
    writeFileSync(path, `${JSON.stringify(unsupported, null, 2)}\n`, 'utf8');

    expect(() => store.readArtifact(written.id)).toThrow(/Unsupported artifact schema version/);
    expect(() => store.listArtifacts('research_packet')).toThrow(/Unsupported artifact schema version/);
  });

  it('rejects artifacts that would persist obvious secrets', () => {
    const artifact = baseArtifact('research_20260512_docs', 'research_packet');
    artifact.payload = {
      excerpt: 'OPENAI_API_KEY=sk-test-secret-value',
    };

    expect(() => store.writeArtifact(artifact)).toThrow(/Secret-like value rejected/);
    expect(store.hasArtifact(artifact.id)).toBe(false);
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
