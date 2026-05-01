import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';

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

export class AgentConfigNotFoundError extends Error {
  constructor(agentId: string) {
    super(`agent.yml not found for agent "${agentId}"`);
    this.name = 'AgentConfigNotFoundError';
  }
}

function agentYmlPath(agentsDir: string, agentId: string): string {
  return join(agentsDir, agentId, 'agent.yml');
}

export function createAgentConfigWriter(opts: CreateAgentConfigWriterOptions): AgentConfigWriter {
  const { agentsDir } = opts;
  const locks = new Map<string, Promise<void>>();

  function readDoc(agentId: string) {
    const path = agentYmlPath(agentsDir, agentId);
    if (!existsSync(path)) throw new AgentConfigNotFoundError(agentId);
    const raw = readFileSync(path, 'utf-8');
    return { path, raw, doc: parseDocument(raw, { keepSourceTokens: true }) };
  }

  async function patchSection(
    agentId: string,
    section: ConfigSection,
    patch: (current: unknown) => unknown | null,
  ): Promise<ConfigWriteResult> {
    const prior = locks.get(agentId) ?? Promise.resolve();
    const run = prior.catch(() => undefined).then(() => doPatch(agentId, section, patch));
    locks.set(
      agentId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  function doPatch(
    agentId: string,
    section: ConfigSection,
    patch: (current: unknown) => unknown | null,
  ): ConfigWriteResult {
    const { path, doc } = readDoc(agentId);
    const prevNode = doc.get(section);
    const prevValue =
      prevNode === undefined
        ? undefined
        : typeof (prevNode as { toJSON?: () => unknown }).toJSON === 'function'
          ? (prevNode as { toJSON: () => unknown }).toJSON()
          : prevNode;

    const newValue = patch(prevValue);
    if (newValue === null) {
      doc.delete(section);
    } else {
      doc.set(section, newValue);
    }

    const serialized = doc.toString();
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, serialized, 'utf-8');
    renameSync(tmpPath, path);

    return {
      agentId,
      section,
      prevValue,
      newValue,
      writtenAt: new Date().toISOString(),
      backupPath: '',
    };
  }

  function readSection(agentId: string, section: ConfigSection): unknown {
    const { doc } = readDoc(agentId);
    const node = doc.get(section);
    if (node === undefined) return undefined;
    if (typeof (node as { toJSON?: () => unknown }).toJSON === 'function') {
      return (node as { toJSON: () => unknown }).toJSON();
    }
    return node;
  }

  function readFullConfig(agentId: string): unknown {
    const { doc } = readDoc(agentId);
    return doc.toJS();
  }

  return { patchSection, readSection, readFullConfig };
}
