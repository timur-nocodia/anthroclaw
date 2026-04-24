import { startPortableSubagentMcpServer } from '../sdk/subagent-mcp.js';

startPortableSubagentMcpServer().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
