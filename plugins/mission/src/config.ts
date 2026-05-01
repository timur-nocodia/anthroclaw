import { z } from 'zod';

export const MissionConfigSchema = z.object({
  enabled: z.boolean()
    .default(false)
    .describe('Master switch for Mission State on this agent. When off, no mission context is injected.'),

  mode: z.enum(['lightweight', 'lifecycle', 'operations', 'custom'])
    .default('lightweight')
    .describe('How much structure the mission uses. Lightweight is current state + next actions.'),

  auto_inject: z.boolean()
    .default(true)
    .describe('Inject a compact mission-state block before each SDK query.'),

  auto_wrap: z.enum(['off', 'suggest', 'strict'])
    .default('suggest')
    .describe('How strongly the skill should encourage end-of-session handoffs. Strict is reserved for later enforcement.'),

  max_injected_chars: z.number().int().min(500).max(20_000)
    .default(6_000)
    .describe('Maximum size of the injected mission-state block.'),
});

export type MissionConfig = z.infer<typeof MissionConfigSchema>;

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    const t = (target as Record<string, unknown>)[k];
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      t !== null &&
      typeof t === 'object' &&
      !Array.isArray(t)
    ) {
      out[k] = deepMerge(t as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function resolveConfig(globalRaw: unknown, perAgentRaw: unknown): MissionConfig {
  const base = MissionConfigSchema.parse(globalRaw ?? {});
  if (!perAgentRaw || typeof perAgentRaw !== 'object') return base;
  const merged = deepMerge(base as Record<string, unknown>, perAgentRaw as Record<string, unknown>);
  return MissionConfigSchema.parse(merged);
}
