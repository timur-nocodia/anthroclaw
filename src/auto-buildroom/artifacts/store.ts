import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { autoBuildroomRoot, roomRoot as resolveRoomRoot } from '../storage/init.js';
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

const ARTIFACT_DIRS: Record<BuildroomArtifactType, string> = {
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
  error_receipt: 'buildroom/errors',
  retention_review: 'buildroom/retention',
};

export class FileArtifactStore {
  private readonly roomRoot: string;

  constructor(private readonly opts: FileArtifactStoreOptions) {
    this.roomRoot = resolveRoomRoot(opts.projectRoot, opts.roomId);
  }

  writeArtifact(artifact: BuildroomArtifact): BuildroomArtifact {
    for (const parentId of artifact.parentIds) {
      if (!this.hasArtifact(parentId)) {
        throw new MissingParentArtifactError(parentId);
      }
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
    const path = this.findArtifactPathById(id);
    if (!path) throw new Error(`Artifact not found: ${id}`);
    return JSON.parse(readFileSync(path, 'utf8')) as BuildroomArtifact;
  }

  hasArtifact(id: string): boolean {
    return this.findArtifactPathById(id) !== null;
  }

  pathForArtifact(artifact: Pick<BuildroomArtifact, 'id' | 'type'>): string {
    return join(this.roomRoot, ARTIFACT_DIRS[artifact.type], `${artifact.id}.json`);
  }

  private findArtifactPathById(id: string): string | null {
    for (const relDir of Object.values(ARTIFACT_DIRS)) {
      const directPath = join(this.roomRoot, relDir, `${id}.json`);
      if (existsSync(directPath)) return directPath;
    }

    const root = autoBuildroomRoot(this.opts.projectRoot);
    const legacyPath = findJsonFile(root, `${id}.json`);
    return legacyPath;
  }
}

function findJsonFile(root: string, filename: string): string | null {
  if (!existsSync(root)) return null;

  const entries = readdirSync(root);
  for (const entry of entries) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      const nested = findJsonFile(path, filename);
      if (nested) return nested;
    } else if (stats.isFile() && entry === filename) {
      return path;
    }
  }

  return null;
}

