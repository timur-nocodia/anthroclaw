export type ConfigSection = 'notifications' | 'human_takeover' | 'operator_console';

export interface ConfigWriteResult {
  agentId: string;
  section: ConfigSection;
  prevValue: unknown;
  newValue: unknown;
  writtenAt: string;
  backupPath: string;
}

export interface AgentConfigWriter {
  patchSection(
    agentId: string,
    section: ConfigSection,
    patch: (current: unknown) => unknown | null,
  ): Promise<ConfigWriteResult>;
  readSection(agentId: string, section: ConfigSection): unknown;
  readFullConfig(agentId: string): unknown;
}

export interface CreateAgentConfigWriterOptions {
  agentsDir: string;
  auditDir?: string;
  backupKeep?: number;
  clock?: () => number;
}

export function createAgentConfigWriter(_opts: CreateAgentConfigWriterOptions): AgentConfigWriter {
  return {
    patchSection: async () => {
      throw new Error('not implemented');
    },
    readSection: () => {
      throw new Error('not implemented');
    },
    readFullConfig: () => {
      throw new Error('not implemented');
    },
  };
}
