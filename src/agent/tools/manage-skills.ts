import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { ToolDefinition } from './types.js';
import {
  assertSkillExists,
  assertSkillMissing,
  resolveNativeSkillPaths,
  validateSkillDocument,
} from '../../security/skill-guard.js';

function atomicWriteFile(targetPath: string, content: string): void {
  const tempPath = join(
    dirname(targetPath),
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.md`,
  );
  writeFileSync(tempPath, content, 'utf-8');
  renameSync(tempPath, targetPath);
}

export function createManageSkillsTool(workspacePath: string): ToolDefinition {
  const sdkTool = tool(
    'manage_skills',
    'Safely manage SDK-native project skills under .claude/skills. Supports read, create, update, and remove for SKILL.md only.',
    {
      action: z.enum(['read', 'create', 'update', 'remove']).describe('Operation to perform on a native project skill'),
      skill_name: z.string().describe('Skill directory name under .claude/skills'),
      content: z.string().optional().describe('Full SKILL.md content for create/update actions'),
    },
    async (args: Record<string, unknown>) => {
      const action = args.action as 'read' | 'create' | 'update' | 'remove';
      const skillName = args.skill_name as string;
      const content = args.content as string | undefined;

      try {
        const { skillRoot, skillDir, skillPath } = resolveNativeSkillPaths(workspacePath, skillName);

        switch (action) {
          case 'read': {
            assertSkillExists(skillPath);
            return {
              content: [{ type: 'text', text: readFileSync(skillPath, 'utf-8') }],
            };
          }
          case 'create': {
            if (!content) {
              throw new Error('content is required for create.');
            }
            validateSkillDocument(content);
            assertSkillMissing(skillPath);
            mkdirSync(skillRoot, { recursive: true });
            mkdirSync(skillDir, { recursive: true });
            atomicWriteFile(skillPath, content);
            return {
              content: [{ type: 'text', text: `Created native skill "${skillName}" at .claude/skills/${skillName}/SKILL.md` }],
            };
          }
          case 'update': {
            if (!content) {
              throw new Error('content is required for update.');
            }
            validateSkillDocument(content);
            assertSkillExists(skillPath);
            mkdirSync(skillDir, { recursive: true });
            atomicWriteFile(skillPath, content);
            return {
              content: [{ type: 'text', text: `Updated native skill "${skillName}"` }],
            };
          }
          case 'remove': {
            assertSkillExists(skillPath);
            rmSync(skillDir, { recursive: true, force: true });
            return {
              content: [{ type: 'text', text: `Removed native skill "${skillName}"` }],
            };
          }
        }
      } catch (err) {
        return {
          content: [{
            type: 'text',
            text: `Skill management failed: ${err instanceof Error ? err.message : String(err)}`,
          }],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false, safe_in_trusted: false, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: ['public', 'trusted'],
};
