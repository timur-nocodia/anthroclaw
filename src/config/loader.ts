import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GlobalConfigSchema, AgentYmlSchema } from './schema.js';
import type { GlobalConfig, AgentYml } from './schema.js';

/**
 * Replaces `${VAR_NAME}` patterns in text with the corresponding
 * process.env values. Unset variables become empty strings.
 */
export function substituteEnvVars(text: string): string {
  return text.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    return process.env[varName] ?? '';
  });
}

function loadYaml<T>(filePath: string, schema: { parse: (data: unknown) => T }): T {
  const raw = readFileSync(filePath, 'utf-8');
  const substituted = substituteEnvVars(raw);
  const data: unknown = parseYaml(substituted);
  return schema.parse(data);
}

export function loadGlobalConfig(filePath: string): GlobalConfig {
  return loadYaml(filePath, GlobalConfigSchema);
}

export function loadAgentYml(agentDir: string): AgentYml {
  return loadYaml(join(agentDir, 'agent.yml'), AgentYmlSchema);
}
