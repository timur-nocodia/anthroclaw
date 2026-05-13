import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { roomRoot as resolveRoomRoot } from '../storage/init.js';
import { computeArtifactContentHash } from './hash.js';
import type { BuildroomArtifact, BuildroomArtifactType } from './model.js';

export interface FileArtifactStoreOptions {
  projectRoot: string;
  roomId: string;
}

export class MissingParentArtifactError extends Error {
  constructor(parentId: string) {
    super(`Missing parent artifact: ${parentId}`);
    this.name = 'MissingParentArtifactError';
  }
}

export class ArtifactHashMismatchError extends Error {
  constructor(id: string) {
    super(`Artifact hash mismatch: ${id}`);
    this.name = 'ArtifactHashMismatchError';
  }
}

export class ArtifactSecretRejectedError extends Error {
  constructor() {
    super('Secret-like value rejected before artifact persistence');
    this.name = 'ArtifactSecretRejectedError';
  }
}

export class UnsupportedArtifactSchemaVersionError extends Error {
  constructor(schemaVersion: unknown) {
    super(`Unsupported artifact schema version: ${String(schemaVersion)}`);
    this.name = 'UnsupportedArtifactSchemaVersionError';
  }
}

export class ArtifactRoomMismatchError extends Error {
  constructor(artifactId: string, artifactRoomId: string, storeRoomId: string) {
    super(`Artifact room mismatch: ${artifactId} belongs to ${artifactRoomId}, store is ${storeRoomId}`);
    this.name = 'ArtifactRoomMismatchError';
  }
}

export class InvalidArtifactIdError extends Error {
  constructor(id: string) {
    super(`Invalid artifact id: ${id}`);
    this.name = 'InvalidArtifactIdError';
  }
}

const ARTIFACT_DIRS: Record<BuildroomArtifactType, string> = {
  session_summary: 'buildroom/session-summaries',
  handoff_signal: 'buildroom/signals',
  research_packet: 'buildroom/research',
  signal: 'buildroom/signals',
  idea_contract: 'buildroom/ideas',
  main_review: 'buildroom/reviews',
  approval: 'buildroom/approvals',
  build_plan: 'buildroom/plans',
  coder_receipt: 'buildroom/builds',
  qa_report: 'buildroom/qa',
  verification_delta: 'buildroom/deltas',
  trust_report: 'buildroom/trust',
  operator_summary: 'buildroom/operator',
  operator_decision: 'buildroom/operator/decisions',
  error_receipt: 'buildroom/errors',
  retention_review: 'buildroom/retention',
};

export class FileArtifactStore {
  private readonly roomRoot: string;

  constructor(private readonly opts: FileArtifactStoreOptions) {
    this.roomRoot = resolveRoomRoot(opts.projectRoot, opts.roomId);
  }

  writeArtifact(artifact: BuildroomArtifact): BuildroomArtifact {
    assertArtifactId(artifact.id);
    assertArtifactRoom(artifact, this.opts.roomId);
    assertNoObviousSecrets(artifact);

    for (const parentId of artifact.parentIds) {
      if (!this.findArtifactPathById(parentId)) {
        throw new MissingParentArtifactError(parentId);
      }
      this.readArtifact(parentId);
    }

    const withHash: BuildroomArtifact = {
      ...artifact,
      contentHash: computeArtifactContentHash(artifact),
    };
    const path = this.pathForArtifact(withHash);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(withHash, null, 2)}\n`, 'utf8');
    return withHash;
  }

  readArtifact(id: string): BuildroomArtifact {
    assertArtifactId(id);
    const path = this.findArtifactPathById(id);
    if (!path) throw new Error(`Artifact not found: ${id}`);
    const artifact = readAndVerifyArtifact(path);
    assertArtifactRoom(artifact, this.opts.roomId);
    return artifact;
  }

  hasArtifact(id: string): boolean {
    assertArtifactId(id);
    return this.findArtifactPathById(id) !== null;
  }

  listArtifacts(type?: BuildroomArtifactType): BuildroomArtifact[] {
    const types = type ? [type] : Object.keys(ARTIFACT_DIRS) as BuildroomArtifactType[];
    const artifacts: BuildroomArtifact[] = [];

    for (const artifactType of types) {
      const dir = join(this.roomRoot, ARTIFACT_DIRS[artifactType]);
      if (!existsSync(dir)) continue;

      for (const entry of readdirSync(dir).sort()) {
        if (!entry.endsWith('.json')) continue;
        const artifact = readAndVerifyArtifact(join(dir, entry));
        assertArtifactRoom(artifact, this.opts.roomId);
        artifacts.push(artifact);
      }
    }

    return artifacts;
  }

  pathForArtifact(artifact: Pick<BuildroomArtifact, 'id' | 'type'>): string {
    assertArtifactId(artifact.id);
    return join(this.roomRoot, ARTIFACT_DIRS[artifact.type], `${artifact.id}.json`);
  }

  private findArtifactPathById(id: string): string | null {
    assertArtifactId(id);
    for (const relDir of Object.values(ARTIFACT_DIRS)) {
      const directPath = join(this.roomRoot, relDir, `${id}.json`);
      if (existsSync(directPath)) return directPath;
    }

    return null;
  }
}

const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function assertArtifactId(id: string): void {
  if (!ARTIFACT_ID_PATTERN.test(id)) {
    throw new InvalidArtifactIdError(id);
  }
}

function assertArtifactRoom(artifact: BuildroomArtifact, storeRoomId: string): void {
  if (artifact.room.id !== storeRoomId) {
    throw new ArtifactRoomMismatchError(artifact.id, artifact.room.id, storeRoomId);
  }
}

function readAndVerifyArtifact(path: string): BuildroomArtifact {
  const artifact = JSON.parse(readFileSync(path, 'utf8')) as BuildroomArtifact;
  if (computeArtifactContentHash(artifact) !== artifact.contentHash) {
    throw new ArtifactHashMismatchError(artifact.id);
  }
  assertSupportedArtifact(artifact);
  return artifact;
}

function assertSupportedArtifact(artifact: BuildroomArtifact): void {
  if (artifact.schemaVersion !== 'auto-buildroom/v1') {
    throw new UnsupportedArtifactSchemaVersionError(artifact.schemaVersion);
  }
  if (!isBuildroomArtifactType(artifact.type)) {
    throw new Error(`Unsupported artifact type: ${String(artifact.type)}`);
  }
}

function isBuildroomArtifactType(value: unknown): value is BuildroomArtifactType {
  return typeof value === 'string' && value in ARTIFACT_DIRS;
}

const SECRET_PATTERNS = [
  /OPENAI_API_KEY\s*=\s*sk-[A-Za-z0-9_-]{8,}/,
  /ANTHROPIC_API_KEY\s*=\s*sk-ant-[A-Za-z0-9_-]{8,}/,
  /\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\brefresh_token\b\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/i,
];

function assertNoObviousSecrets(value: unknown): void {
  for (const text of collectStrings(value)) {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new ArtifactSecretRejectedError();
    }
  }
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectStrings(item));
  }
  return [];
}
