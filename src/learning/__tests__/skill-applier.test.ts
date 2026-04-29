import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LearningStore } from '../store.js';
import type { LearningActionRecord } from '../types.js';
import { applySkillAction } from '../skill-applier.js';

const VALID_SKILL = [
  '---',
  'name: publishing',
  'description: Publishing rules',
  '---',
  '# Publishing',
  '',
  'Always ask before publishing.',
  '',
].join('\n');

describe('applySkillAction', () => {
  let dir: string;
  let workspacePath: string;
  let learningStore: LearningStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'anthroclaw-skill-applier-'));
    workspacePath = join(dir, 'workspace');
    mkdirSync(workspacePath, { recursive: true });
    learningStore = new LearningStore(join(dir, 'learning.sqlite'));
  });

  afterEach(() => {
    learningStore.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates native skills only under .claude/skills/*/SKILL.md', () => {
    const result = applySkillAction(baseParams(action({
      id: 'action-create',
      actionType: 'skill_create',
      payload: {
        skillName: 'publishing',
        path: '.claude/skills/publishing/SKILL.md',
        body: VALID_SKILL,
      },
    })));

    expect(toWorkspaceRelative(result.skillPath)).toBe('.claude/skills/publishing/SKILL.md');
    expect(readFileSync(result.skillPath, 'utf8')).toBe(VALID_SKILL);
    expect(learningStore.getAction('action-create')).toMatchObject({ status: 'applied' });
  });

  it('patches existing skills with a snapshot before write', () => {
    const skillPath = seedSkill('publishing', VALID_SKILL);
    const result = applySkillAction(baseParams(action({
      id: 'action-patch',
      actionType: 'skill_patch',
      payload: {
        skillName: 'publishing',
        oldText: 'Always ask before publishing.',
        newText: 'Always ask before publishing or scheduling.',
      },
    })));

    expect(readFileSync(skillPath, 'utf8')).toContain('Always ask before publishing or scheduling.');
    expect(result.snapshotId).toBeTruthy();
    expect(learningStore.listSkillSnapshots({ actionId: 'action-patch' })).toEqual([
      expect.objectContaining({
        skillName: 'publishing',
        path: '.claude/skills/publishing/SKILL.md',
        body: VALID_SKILL,
        reason: 'before skill_patch',
      }),
    ]);
  });

  it('updates full skill content with a snapshot before write', () => {
    seedSkill('publishing', VALID_SKILL);
    const next = VALID_SKILL.replace('# Publishing', '# Publishing Rules');

    const result = applySkillAction(baseParams(action({
      id: 'action-update',
      actionType: 'skill_update_full',
      payload: {
        skillName: 'publishing',
        body: next,
      },
    })));

    expect(readFileSync(result.skillPath, 'utf8')).toBe(next);
    expect(learningStore.listSkillSnapshots({ actionId: 'action-update' })).toHaveLength(1);
  });

  it('rejects public/trusted auto-apply and private non-auto_private auto-apply', () => {
    const skillAction = action({
      actionType: 'skill_create',
      payload: { skillName: 'publishing', body: VALID_SKILL },
    });

    expect(() => applySkillAction(baseParams(skillAction, { safetyProfile: 'public', mode: 'auto_private' })))
      .toThrow(/only allowed/);
    expect(() => applySkillAction(baseParams(skillAction, { safetyProfile: 'trusted', mode: 'auto_private' })))
      .toThrow(/only allowed/);
    expect(() => applySkillAction(baseParams(skillAction, { safetyProfile: 'private', mode: 'propose' })))
      .toThrow(/only allowed/);
  });

  it('rejects path traversal and mismatched payload paths', () => {
    expect(() => applySkillAction(baseParams(action({
      actionType: 'skill_create',
      payload: { skillName: '../escape', body: VALID_SKILL },
    })))).toThrow(/Invalid skill name/);

    expect(() => applySkillAction(baseParams(action({
      actionType: 'skill_create',
      payload: {
        skillName: 'publishing',
        path: '../SKILL.md',
        body: VALID_SKILL,
      },
    })))).toThrow(/skill action path/);
  });

  it('rejects missing, ambiguous, invalid, and oversized patch targets', () => {
    seedSkill('publishing', VALID_SKILL.replace('Always ask before publishing.', 'Repeat\nRepeat'));

    expect(() => applySkillAction(baseParams(action({
      actionType: 'skill_patch',
      payload: { skillName: 'publishing', oldText: 'Missing', newText: 'New' },
    })))).toThrow(/not found/);

    expect(() => applySkillAction(baseParams(action({
      actionType: 'skill_patch',
      payload: { skillName: 'publishing', oldText: 'Repeat', newText: 'New' },
    })))).toThrow(/ambiguous/);

    expect(() => applySkillAction(baseParams(action({
      actionType: 'skill_patch',
      payload: { skillName: 'publishing', oldText: '# Publishing', newText: 'No heading' },
    })))).toThrow(/heading/);

    expect(() => applySkillAction(baseParams(action({
      actionType: 'skill_update_full',
      payload: { skillName: 'publishing', body: `${VALID_SKILL}\n${'x'.repeat(128 * 1024)}` },
    })))).toThrow(/exceeds/);
  });

  function baseParams(
    skillAction: LearningActionRecord,
    overrides: Partial<Parameters<typeof applySkillAction>[0]> = {},
  ): Parameters<typeof applySkillAction>[0] {
    if (!learningStore.getReview(skillAction.reviewId)) {
      learningStore.createReview({
        id: skillAction.reviewId,
        agentId: skillAction.agentId,
        trigger: 'manual',
        mode: 'auto_private',
      });
    }
    if (!learningStore.getAction(skillAction.id)) {
      learningStore.addAction({
        id: skillAction.id,
        reviewId: skillAction.reviewId,
        agentId: skillAction.agentId,
        actionType: skillAction.actionType,
        confidence: skillAction.confidence,
        title: skillAction.title,
        rationale: skillAction.rationale,
        payload: skillAction.payload,
        createdAt: skillAction.createdAt,
      });
    }
    return {
      workspacePath,
      learningStore,
      action: skillAction,
      safetyProfile: 'private',
      mode: 'auto_private',
      agentId: skillAction.agentId,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      ...overrides,
    };
  }

  function seedSkill(skillName: string, body: string): string {
    const skillDir = join(workspacePath, '.claude', 'skills', skillName);
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, 'SKILL.md');
    writeFileSync(skillPath, body, 'utf8');
    return skillPath;
  }

  function toWorkspaceRelative(path: string): string {
    return path.slice(workspacePath.length + 1).split('\\').join('/');
  }
});

function action(overrides: Partial<LearningActionRecord> = {}): LearningActionRecord {
  const now = Date.now();
  return {
    id: 'action',
    reviewId: 'review',
    agentId: 'agent-a',
    actionType: 'skill_patch',
    status: 'proposed',
    title: 'Skill action',
    rationale: '',
    payload: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
