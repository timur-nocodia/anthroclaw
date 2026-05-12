import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  assertValidBuildroomConfig,
  createDefaultBuildroomConfig,
  type BuildroomConfig,
} from '../config/model.js';

export interface InitializeBuildroomStorageOptions {
  projectRoot: string;
  roomId?: string;
  operatorId?: string;
  overwrite?: boolean;
}

export interface InitializeBuildroomStorageResult {
  root: string;
  roomRoot: string;
  configPath: string;
  roomConfigPath: string;
  config: BuildroomConfig;
  created: string[];
}

export interface BuildroomRootConfig {
  schemaVersion: 'auto-buildroom/v1';
  defaultRoom: string;
  rooms: Record<string, { path: string }>;
}

export class BuildroomConfigExistsError extends Error {
  constructor(path: string) {
    super(`Buildroom config already exists: ${path}`);
    this.name = 'BuildroomConfigExistsError';
  }
}

const REQUIRED_ROOM_DIRS = [
  'research-vault/findings',
  'research-vault/claims',
  'research-vault/dossiers',
  'subconscious-room/signals',
  'subconscious-room/ghosts',
  'buildroom/research',
  'buildroom/signals',
  'buildroom/ideas',
  'buildroom/reviews',
  'buildroom/approvals',
  'buildroom/plans',
  'buildroom/builds',
  'buildroom/qa',
  'buildroom/deltas',
  'buildroom/trust',
  'buildroom/operator/reports',
  'buildroom/transitions',
  'runtime/events',
  'runtime/results',
  'worktrees',
  'archive',
] as const;

export function autoBuildroomRoot(projectRoot: string): string {
  return join(resolve(projectRoot), '.anthroclaw', 'auto-buildroom');
}

export function roomRoot(projectRoot: string, roomId: string): string {
  return join(autoBuildroomRoot(projectRoot), 'rooms', roomId);
}

export function initializeBuildroomStorage(
  opts: InitializeBuildroomStorageOptions,
): InitializeBuildroomStorageResult {
  const projectRoot = resolve(opts.projectRoot);
  const roomId = opts.roomId ?? 'anthroclaw-core';
  const operatorId = opts.operatorId ?? 'cli:user:local-operator';
  const root = autoBuildroomRoot(projectRoot);
  const room = roomRoot(projectRoot, roomId);
  const configPath = join(root, 'buildroom.yml');
  const roomConfigPath = join(room, 'buildroom.yml');

  if (!opts.overwrite && (existsSync(configPath) || existsSync(roomConfigPath))) {
    throw new BuildroomConfigExistsError(existsSync(roomConfigPath) ? roomConfigPath : configPath);
  }

  const roomConfig = assertValidBuildroomConfig(
    createDefaultBuildroomConfig({ roomId, operatorId }),
  );

  const created: string[] = [];
  for (const dir of [
    root,
    join(root, 'locks'),
    join(root, 'rooms'),
    room,
    ...REQUIRED_ROOM_DIRS.map((rel) => join(room, rel)),
  ]) {
    ensureDir(dir, created);
  }

  const rootConfig: BuildroomRootConfig = {
    schemaVersion: 'auto-buildroom/v1',
    defaultRoom: roomId,
    rooms: {
      [roomId]: { path: `rooms/${roomId}/buildroom.yml` },
    },
  };

  writeFileSync(configPath, stringifyYaml(rootConfig), 'utf8');
  writeFileSync(roomConfigPath, stringifyYaml(roomConfig), 'utf8');

  return {
    root,
    roomRoot: room,
    configPath,
    roomConfigPath,
    config: roomConfig,
    created,
  };
}

export function loadBuildroomRootConfig(projectRoot: string): BuildroomRootConfig {
  const configPath = join(autoBuildroomRoot(projectRoot), 'buildroom.yml');
  const data = parseYaml(readFileSync(configPath, 'utf8')) as BuildroomRootConfig;
  return data;
}

export function loadBuildroomRoomConfig(projectRoot: string, roomId?: string): BuildroomConfig {
  const rootConfig = loadBuildroomRootConfig(projectRoot);
  const resolvedRoomId = roomId ?? rootConfig.defaultRoom;
  const roomEntry = rootConfig.rooms[resolvedRoomId];
  if (!roomEntry) throw new Error(`Buildroom room not found: ${resolvedRoomId}`);
  const raw = readFileSync(join(autoBuildroomRoot(projectRoot), roomEntry.path), 'utf8');
  return assertValidBuildroomConfig(parseYaml(raw));
}

export function saveBuildroomRoomConfig(projectRoot: string, config: BuildroomConfig): void {
  const rootConfig = loadBuildroomRootConfig(projectRoot);
  const roomEntry = rootConfig.rooms[config.roomId];
  if (!roomEntry) throw new Error(`Buildroom room not found: ${config.roomId}`);
  const validConfig = assertValidBuildroomConfig(config);
  writeFileSync(
    join(autoBuildroomRoot(projectRoot), roomEntry.path),
    stringifyYaml(validConfig),
    'utf8',
  );
}

function ensureDir(path: string, created: string[]): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
    created.push(path);
  }
}
