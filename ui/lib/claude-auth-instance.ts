import { ClaudeAuthManager } from './claude-auth';

let manager: ClaudeAuthManager | null = null;

export function getClaudeAuthManager(): ClaudeAuthManager {
  manager ??= new ClaudeAuthManager();
  return manager;
}

export function _resetClaudeAuthManagerForTest(): void {
  manager = null;
}
