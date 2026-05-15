export type RuntimeId = string;

export interface RuntimeCapabilities {
  streaming: boolean;
  sessions: boolean;
  interrupt: boolean;
  approvals: boolean;
  mcp: boolean;
  subagents: boolean;
  checkpoints: boolean;
  warmStart: boolean;
}

export interface RuntimeRunInput<TOptions> {
  prompt: string | AsyncIterable<unknown>;
  options: TOptions;
}

export interface RuntimeStartupInput<TOptions> {
  options: TOptions;
}

export interface RuntimeMcpServerInput<TTool = unknown> {
  name: string;
  tools: TTool[];
}

export interface RuntimeAdapter<TOptions, TQuery, TWarmQuery = unknown, TMcpServer = unknown> {
  id: RuntimeId;
  capabilities: RuntimeCapabilities;
  query(input: RuntimeRunInput<TOptions>): TQuery;
  startup?(input: RuntimeStartupInput<TOptions>): Promise<TWarmQuery>;
  createMcpServer?(input: RuntimeMcpServerInput): TMcpServer;
}
