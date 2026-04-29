import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runLearningCli } from '../learning.js';
import { LearningStore } from '../../learning/store.js';
import { MemoryStore } from '../../memory/store.js';

describe('learning CLI', () => {
  let root: string;
  let dataDir: string;
  let agentsDir: string;
  let store: LearningStore;
  const out: string[] = [];
  const err: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-learning-cli-'));
    dataDir = join(root, 'data');
    agentsDir = join(root, 'agents');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(agentsDir, { recursive: true });
    store = new LearningStore(join(dataDir, 'learning.sqlite'));
    out.length = 0;
    err.length = 0;
  });

  afterEach(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists, shows, approves, and rejects learning actions', async () => {
    seedAction('memory-1', 'memory_candidate', { text: 'Remember concise final replies.' });
    seedAction('skill-1', 'skill_patch', { skillName: 'publishing', oldText: 'a', newText: 'b' });

    await expect(run(['list', '--status', 'proposed'])).resolves.toBe(0);
    expect(out.join('\n')).toContain('memory-1');
    expect(out.join('\n')).toContain('skill-1');

    out.length = 0;
    await expect(run(['show', 'skill-1'])).resolves.toBe(0);
    expect(out.join('\n')).toContain('skill patch:');
    expect(out.join('\n')).toContain('--- oldText ---');

    await expect(run(['approve', 'memory-1'])).resolves.toBe(0);
    expect(store.getAction('memory-1')).toMatchObject({ status: 'approved' });

    await expect(run(['reject', 'skill-1', '--reason', 'not needed'])).resolves.toBe(0);
    expect(store.getAction('skill-1')).toMatchObject({ status: 'rejected', error: 'not needed' });
  });

  it('filters list output by agent id', async () => {
    seedAction('agent-a-memory', 'memory_candidate', { text: 'Agent A memory.' }, 'proposed', 'agent-a');
    seedAction('agent-b-memory', 'memory_candidate', { text: 'Agent B memory.' }, 'proposed', 'agent-b');

    await expect(run(['list', '--agent', 'agent-b'])).resolves.toBe(0);

    expect(out.join('\n')).toContain('agent-b-memory');
    expect(out.join('\n')).not.toContain('agent-a-memory');
  });

  it('applies approved memory candidates as approved memory entries', async () => {
    seedAgent('agent-a', 'trusted');
    seedAction('memory-apply', 'memory_candidate', {
      text: 'The user wants short release summaries.',
      kind: 'preference',
    }, 'approved');

    await expect(run(['apply', 'memory-apply'])).resolves.toBe(0);

    const memoryStore = new MemoryStore(join(dataDir, 'memory-db', 'agent-a.sqlite'));
    try {
      expect(memoryStore.listMemoryEntries({ reviewStatus: 'approved' })).toHaveLength(1);
      expect(memoryStore.textSearch('release summaries', 5)).toHaveLength(1);
    } finally {
      memoryStore.close();
    }
    expect(store.getAction('memory-apply')).toMatchObject({ status: 'applied' });
  });

  it('applies approved skill actions manually and shows patch diff details', async () => {
    seedAgent('agent-a', 'public');
    seedAction('skill-create', 'skill_create', {
      skillName: 'publishing',
      body: [
        '---',
        'name: publishing',
        'description: Publishing rules',
        '---',
        '# Publishing',
        '',
        'Ask before publishing.',
      ].join('\n'),
    }, 'approved');

    await expect(run(['apply', 'skill-create'])).resolves.toBe(0);

    const skillPath = join(agentsDir, 'agent-a', '.claude', 'skills', 'publishing', 'SKILL.md');
    expect(readFileSync(skillPath, 'utf8')).toContain('Ask before publishing.');
    expect(store.getAction('skill-create')).toMatchObject({ status: 'applied' });
  });

  it('refuses to apply actions before approval', async () => {
    seedAgent('agent-a', 'trusted');
    seedAction('memory-proposed', 'memory_candidate', { text: 'Do not apply yet.' });

    await expect(run(['apply', 'memory-proposed'])).resolves.toBe(1);
    expect(err.join('\n')).toContain('must be approved');
  });

  function seedAgent(agentId: string, safetyProfile: 'public' | 'trusted' | 'private'): void {
    const dir = join(agentsDir, agentId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent.yml'), [
      `safety_profile: ${safetyProfile}`,
      'routes:',
      '  - channel: telegram',
      'learning:',
      '  enabled: true',
      '  mode: propose',
    ].join('\n'), 'utf8');
  }

  function seedAction(
    actionId: string,
    actionType: 'memory_candidate' | 'skill_patch' | 'skill_create',
    payload: Record<string, unknown>,
    status: 'proposed' | 'approved' = 'proposed',
    agentId = 'agent-a',
  ): void {
    const reviewId = `review-${agentId}`;
    if (!store.getReview(reviewId)) {
      store.createReview({ id: reviewId, agentId, trigger: 'manual', mode: 'propose' });
    }
    store.addAction({
      id: actionId,
      reviewId,
      agentId,
      actionType,
      status,
      title: actionId,
      payload,
    });
  }

  function run(argv: string[]): Promise<number> {
    return runLearningCli([
      ...argv,
      '--data-dir',
      dataDir,
      '--agents-dir',
      agentsDir,
    ], {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    });
  }
});
