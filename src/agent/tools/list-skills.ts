import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'node:fs';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';
import { discoverWorkspaceSkills, readWorkspaceSkill } from '../../skills/workspace.js';

export function createListSkillsTool(
  workspacePath: string,
): ToolDefinition {
  const sdkTool = tool(
    'list_skills',
    'List agent-local SDK skills, or read a specific SKILL.md. Uses .claude/skills as the native source and reads legacy skills/ only as a compatibility fallback.',
    {
      skill_name: z.string().optional().describe('If provided, read the full SKILL.md for this skill. Otherwise list all available skills.'),
    },
    async (args: Record<string, unknown>) => {
      const skillName = args.skill_name as string | undefined;

      if (skillName) {
        const skill = readWorkspaceSkill(workspacePath, skillName);
        if (!skill) {
          return {
            content: [{ type: 'text', text: `Skill "${skillName}" not found in .claude/skills or skills.` }],
            isError: true,
          };
        }
        const content = readFileSync(skill.skillPath, 'utf-8');
        return { content: [{ type: 'text', text: content }] };
      }

      const skills = discoverWorkspaceSkills({ workspacePath });

      if (skills.length === 0) {
        return {
          content: [{ type: 'text', text: 'No skills found in .claude/skills or skills/.' }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: `Available skills (${skills.length}):\n\n${skills.map((skill) => {
            const description = skill.description ? ` — ${skill.description}` : '';
            const tags = skill.tags.length > 0 ? ` [${skill.tags.join(', ')}]` : '';
            const platforms = skill.platforms.length > 0 ? ` (${skill.platforms.join(', ')})` : '';
            const source = skill.native ? ' [.claude/skills]' : ' [compat skills/]';
            return `- **${skill.name}**: ${skill.title}${description}${tags}${platforms}${source}`;
          }).join('\n')}`,
        }],
      };
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

export const META: ToolMeta = {
  category: 'read-only',
  safe_in_public: true, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: true, hard_blacklist_in: [],
};
