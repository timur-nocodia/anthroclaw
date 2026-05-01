import { z } from 'zod';

/**
 * Manager-side declaration model (Variant 1):
 *   - The OPERATOR agent's config lists which agents it `manages`.
 *   - The MANAGED agent does not need to opt in.
 *   - `manages: '*'` is super-admin (can act on any agent).
 *
 * `capabilities` is a bag of tool names the operator agent is allowed to
 * use. When omitted (or empty) all tools are exposed.
 */

export const CapabilityNameSchema = z.enum([
  'peer_pause',
  'delegate',
  'list_peers',
  'peer_summary',
  'escalate',
]);

export type CapabilityName = z.infer<typeof CapabilityNameSchema>;

export const OperatorConsoleConfigSchema = z.object({
  enabled: z
    .boolean()
    .default(false)
    .describe(
      'Master switch. When off the plugin registers no tools and refuses every action.',
    ),
  manages: z
    .union([z.literal('*'), z.array(z.string().min(1))])
    .default([])
    .describe(
      'Which agent IDs this operator agent may manage. Use "*" for super-admin (any agent).',
    ),
  capabilities: z
    .array(CapabilityNameSchema)
    .default(['peer_pause', 'delegate', 'list_peers', 'peer_summary', 'escalate'])
    .describe(
      'Subset of operator tools to expose. Empty array = none; default = all five.',
    ),
});

export type OperatorConsoleConfig = z.infer<typeof OperatorConsoleConfigSchema>;

/**
 * Parse + apply defaults. `rawCfg` is the per-agent `plugins['operator-console']`
 * blob from agent.yml (or undefined when the agent omits the section).
 */
export function resolveConfig(rawCfg: unknown): OperatorConsoleConfig {
  return OperatorConsoleConfigSchema.parse(rawCfg ?? {});
}
