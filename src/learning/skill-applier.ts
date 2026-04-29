import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  assertSkillExists,
  assertSkillMissing,
  resolveNativeSkillPaths,
  validateSkillDocument,
} from '../security/skill-guard.js';
import { metrics } from '../metrics/collector.js';
import type { LearningMode, LearningActionRecord } from './types.js';
import { LearningStore } from './store.js';

export type SkillApplierSafetyProfile = 'public' | 'trusted' | 'private' | 'chat_like_openclaw';

export interface ApplySkillActionParams {
  workspacePath: string;
  learningStore: LearningStore;
  action: LearningActionRecord;
  safetyProfile: SkillApplierSafetyProfile;
  mode: LearningMode;
  agentId: string;
  autoApply?: boolean;
  now?: () => Date;
}

export interface ApplySkillActionResult {
  skillName: string;
  skillPath: string;
  contentHash: string;
  snapshotId?: string;
}

export function applySkillAction(params: ApplySkillActionParams): ApplySkillActionResult {
  try {
    return applySkillActionUnsafe(params);
  } catch (err) {
    if (params.action.actionType === 'skill_patch') {
      metrics.increment('learning_skill_patch_failed');
    }
    throw err;
  }
}

function applySkillActionUnsafe(params: ApplySkillActionParams): ApplySkillActionResult {
  const autoApply = params.autoApply ?? true;
  if (autoApply) {
    assertAutoApplyAllowed(params.safetyProfile, params.mode);
  }

  const actionType = params.action.actionType;
  if (!['skill_patch', 'skill_create', 'skill_update_full'].includes(actionType)) {
    throw new Error(`Cannot apply action type "${actionType}" as a skill action`);
  }

  const skillName = readPayloadString(params.action.payload, 'skillName')
    ?? readPayloadString(params.action.payload, 'skill_name');
  if (!skillName) {
    throw new Error('skill action payload.skillName is required');
  }

  const paths = resolveNativeSkillPaths(params.workspacePath, skillName);
  validateOptionalPayloadPath(params.workspacePath, params.action.payload, skillName);

  switch (actionType) {
    case 'skill_create':
      return applySkillCreate(params, skillName, paths.skillRoot, paths.skillDir, paths.skillPath);
    case 'skill_update_full':
      return applySkillUpdateFull(params, skillName, paths.skillPath);
    case 'skill_patch':
      return applySkillPatch(params, skillName, paths.skillPath);
    default:
      throw new Error(`Unsupported skill action type "${actionType}"`);
  }
}

function applySkillCreate(
  params: ApplySkillActionParams,
  skillName: string,
  skillRoot: string,
  skillDir: string,
  skillPath: string,
): ApplySkillActionResult {
  const body = requirePayloadString(params.action.payload, 'body');
  validateSkillDocument(body);
  assertSkillMissing(skillPath);
  mkdirSync(skillRoot, { recursive: true });
  mkdirSync(skillDir, { recursive: true });
  atomicWriteFile(skillPath, body);
  if (params.autoApply ?? true) {
    metrics.increment('learning_actions_auto_applied');
  }
  params.learningStore.updateActionStatus(params.action.id, 'applied', {
    appliedAt: params.now?.().getTime(),
  });
  return {
    skillName,
    skillPath,
    contentHash: sha256(body),
  };
}

function applySkillUpdateFull(
  params: ApplySkillActionParams,
  skillName: string,
  skillPath: string,
): ApplySkillActionResult {
  const body = requirePayloadString(params.action.payload, 'body');
  validateSkillDocument(body);
  assertSkillExists(skillPath);
  const snapshotId = snapshotExistingSkill(params, skillName, skillPath, 'before skill_update_full');
  atomicWriteFile(skillPath, body);
  if (params.autoApply ?? true) {
    metrics.increment('learning_actions_auto_applied');
  }
  params.learningStore.updateActionStatus(params.action.id, 'applied', {
    appliedAt: params.now?.().getTime(),
  });
  return {
    skillName,
    skillPath,
    contentHash: sha256(body),
    snapshotId,
  };
}

function applySkillPatch(
  params: ApplySkillActionParams,
  skillName: string,
  skillPath: string,
): ApplySkillActionResult {
  assertSkillExists(skillPath);
  const oldText = requirePayloadString(params.action.payload, 'oldText');
  const newText = requirePayloadString(params.action.payload, 'newText');
  if (oldText.length === 0) {
    throw new Error('skill_patch payload.oldText must not be empty');
  }
  const current = readFileSync(skillPath, 'utf8');
  const occurrences = countOccurrences(current, oldText);
  if (occurrences === 0) {
    throw new Error('skill_patch oldText target was not found');
  }
  if (occurrences > 1) {
    throw new Error('skill_patch oldText target is ambiguous');
  }

  const next = current.replace(oldText, newText);
  validateSkillDocument(next);
  const snapshotId = snapshotExistingSkill(params, skillName, skillPath, 'before skill_patch');
  atomicWriteFile(skillPath, next);
  if (params.autoApply ?? true) {
    metrics.increment('learning_actions_auto_applied');
  }
  params.learningStore.updateActionStatus(params.action.id, 'applied', {
    appliedAt: params.now?.().getTime(),
  });
  return {
    skillName,
    skillPath,
    contentHash: sha256(next),
    snapshotId,
  };
}

function snapshotExistingSkill(
  params: ApplySkillActionParams,
  skillName: string,
  skillPath: string,
  reason: string,
): string {
  const body = readFileSync(skillPath, 'utf8');
  const snapshot = params.learningStore.addSkillSnapshot({
    actionId: params.action.id,
    agentId: params.agentId,
    skillName,
    path: toPortablePath(relative(params.workspacePath, skillPath)),
    contentHash: sha256(body),
    body,
    reason,
    metadata: {
      actionType: params.action.actionType,
      safetyProfile: params.safetyProfile,
      mode: params.mode,
    },
    createdAt: params.now?.().getTime(),
  });
  return snapshot.id;
}

function assertAutoApplyAllowed(safetyProfile: SkillApplierSafetyProfile, mode: LearningMode): void {
  if (safetyProfile !== 'private' || mode !== 'auto_private') {
    throw new Error('Automatic skill application is only allowed for safety_profile=private with learning.mode=auto_private');
  }
}

function validateOptionalPayloadPath(workspacePath: string, payload: Record<string, unknown>, skillName: string): void {
  const payloadPath = readPayloadString(payload, 'path');
  if (!payloadPath) return;
  const expected = `.claude/skills/${skillName}/SKILL.md`;
  const normalized = toPortablePath(payloadPath);
  if (normalized !== expected) {
    throw new Error(`skill action path must be ${expected}`);
  }
  const resolved = resolveNativeSkillPaths(workspacePath, skillName);
  const relativePath = toPortablePath(relative(workspacePath, resolved.skillPath));
  if (relativePath !== expected) {
    throw new Error('Resolved skill path did not match expected native skill path');
  }
}

function requirePayloadString(payload: Record<string, unknown>, key: string): string {
  const value = readPayloadString(payload, key);
  if (value === undefined) {
    throw new Error(`skill action payload.${key} is required`);
  }
  return value;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function atomicWriteFile(targetPath: string, content: string): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tempPath = join(
    dirname(targetPath),
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.md`,
  );
  try {
    writeFileSync(tempPath, content, 'utf8');
    renameSync(tempPath, targetPath);
  } catch (err) {
    if (existsSync(tempPath)) {
      try {
        writeFileSync(tempPath, '', 'utf8');
      } catch {}
    }
    throw err;
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toPortablePath(path: string): string {
  return path.split('\\').join('/');
}
