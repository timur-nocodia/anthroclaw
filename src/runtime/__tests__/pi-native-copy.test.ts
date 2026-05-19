import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');

const publicRuntimeSurfaces = [
  '.env.example',
  'config.yml',
  'package.json',
  'README.md',
  'docs/guide.md',
  'docs/customer-facing-agent-template.md',
  'docs/pi-default-runtime-rollout.md',
  'docs/pi-production-canary-runbook.md',
  'docs/pi-ring-expansion-policy.md',
  'docs/runtime-migration-rules.md',
  'docs/runtime-side-effect-gates.md',
  'docs/honcho-integration.md',
  'docs/Auto-Buildroom/02-anthroclaw-integration-model.md',
  'docs/Auto-Buildroom/12-config-model.md',
  'research/runtime-v1-migration-status.md',
  'research/runtime-v1-production-canary-preflight.md',
  'research/runtime-contract-v1.md',
  'research/runtime-v1-canary-plan.md',
  'research/runtime-v1-parity-matrix.md',
  'research/runtime-migration-execution-plan.md',
  'research/ui-pi-runtime-control-plane-checklist.md',
  'ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx',
  'ui/components/settings/ClaudeAuthPanel.tsx',
  'ui/components/mcp/McpServersSection.tsx',
  'src/agent/tools/manage-skills.ts',
  'agents/example/CLAUDE.md',
  'agents/example/agent.yml',
  'agents/example/soul.md',
];

const forbiddenPrimaryRuntimeCopy = [
  /Claude Agent SDK-native/i,
  /Agent SDK-native/i,
  /SDK-native/i,
  /Claude-native/i,
  /native Claude/i,
  /Claude Code path/i,
  /Agent SDK path/i,
  /Agent SDK-equivalent/i,
  /1:1 Agent SDK/i,
  /harness parity/i,
  /Anthropic subscription/i,
  /subscription plans/i,
  /Claude subscription auth/i,
  /Connect Claude subscription/i,
  /api\/fleet\/\$\{serverId\}\/claude-auth/i,
  /CLAUDE_CODE_OAUTH_TOKEN/i,
  /runtime:pi-telegram-lab/i,
  /runtime:pi-timur/i,
  /legacy_lab_agent/i,
  /legacy_telegram_lab/i,
  /legacy_sales_lab/i,
  /content_sm_building/i,
  /\bcustomer assistant\b/i,
  /agent_alpha/i,
  /Klavdia/i,
  /Jarvis/i,
  /48705953/i,
  /clowwy/i,
  /\/Users\/tyess/i,
];

function listShippedAgentFiles(): string[] {
  try {
    return execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'agents'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
  } catch {
    const agentsRoot = resolve(repoRoot, 'agents');
    const files: string[] = [];
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        const rel = path.slice(repoRoot.length + 1);
        if (entry.isDirectory()) {
          visit(path);
        } else if (entry.isFile()) {
          files.push(rel);
        }
      }
    };
    if (existsSync(agentsRoot)) visit(agentsRoot);
    return files;
  }
}

describe('Pi-native public runtime copy', () => {
  it('does not present Claude Agent SDK as the primary runtime target', () => {
    const offenders: string[] = [];

    for (const file of publicRuntimeSurfaces) {
      const text = readFileSync(resolve(repoRoot, file), 'utf8');
      for (const pattern of forbiddenPrimaryRuntimeCopy) {
        if (pattern.test(text)) offenders.push(`${file}: ${pattern}`);
      }
    }

    expect(offenders, `Legacy primary-runtime copy found:\n${offenders.join('\n')}`).toHaveLength(0);
  });

  it('does not ship private rollout agent directories in the OSS example surface', () => {
    const forbiddenAgentDirs = [
      'agents/legacy_lab_agent',
      'agents/legacy_telegram_lab',
    ];

    const existing = forbiddenAgentDirs.filter((dir) => existsSync(resolve(repoRoot, dir)));

    expect(existing, `Private rollout agent directories found:\n${existing.join('\n')}`).toHaveLength(0);
  });

  it('does not ship agent credential artifacts in the OSS example surface', () => {
    const files = listShippedAgentFiles();
    const offenders = files.filter((file) => {
      const segments = file.split('/');
      return segments.includes('credentials') || file.endsWith('.enc') || segments.at(-1) === '.env';
    });

    expect(offenders, `Agent credential artifacts found:\n${offenders.join('\n')}`).toHaveLength(0);
  });
});
