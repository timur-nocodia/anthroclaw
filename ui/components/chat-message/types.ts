export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output?: string;
  status: "running" | "done";
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  toolCalls?: ToolCall[];
  taskProgress?: string;
  ts: Date;
  streaming?: boolean;
}
