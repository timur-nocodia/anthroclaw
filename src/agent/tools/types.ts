export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

// Re-export the SDK MCP server type for convenience
export type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
