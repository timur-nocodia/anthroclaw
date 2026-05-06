/**
 * Tools exposed by the Claude Code SDK preset / settingSources that conflict
 * with anthroclaw's own runtime. Always blocked at SDK level via Options.disallowedTools
 * so agents cannot accidentally invoke them instead of our equivalents.
 *
 * Why: the `claude_code` preset advertises harness primitives (RemoteTrigger,
 * CronCreate, TodoWrite, etc.) that look attractive to the model but either
 * don't work in our runtime or conflict with our own tools (manage_cron,
 * memory_write). Blocking them forces the agent to use the correct anthroclaw
 * MCP tools.
 *
 * This is a documented SDK option — does not bypass query() or Messages API.
 *
 * Users can extend this list per-agent via `agent.yml`:
 *
 *   sdk:
 *     disallowedTools:
 *       - SomeOtherTool
 *
 * The two lists are merged at buildSdkOptions time.
 */
export const HARNESS_BLOCKLIST: readonly string[] = [
  // Replaced by anthroclaw's persistent manage_cron tool.
  'RemoteTrigger',
  'CronCreate',
  'CronDelete',
  'CronList',
  'CronUpdate',

  // Replaced by anthroclaw's memory_write tool.
  'TodoWrite',

  // Plan/worktree primitives have no meaning in chat-bot context.
  'EnterPlanMode',
  'ExitPlanMode',
  'EnterWorktree',
  'ExitWorktree',

  // Interactive prompts the bot cannot use over async chat channels.
  'AskUserQuestion',
  'PushNotification',

  // Long-running monitoring primitives — agents should not start their own.
  'Monitor',

  // Harness Task* — confusing alongside our cron jobs.
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskOutput',
  'TaskStop',

  // Generic MCP enumeration the model should never need.
  'ReadMcpResourceTool',
  'ListMcpResourcesTool',

  // Deferred-tool discovery from the host Claude Code runtime. Without this,
  // an agent can ToolSearch its way to mcp__claude_ai_* tools that leak in
  // via the bind-mounted ~/.claude/ (host OAuth-token mount). Names appear
  // in `deferred_tools_delta` regardless of `enabledMcpjsonServers: []`
  // because Claude Code reads its own settings on startup. The cutoff
  // canUseTool gate would deny the actual call, but blocking ToolSearch at
  // SDK-option layer is a cleaner closure (defence-in-depth).
  'ToolSearch',
];
