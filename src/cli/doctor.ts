import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export async function runDiagnostics(opts: {
  dataDir: string;
  agentsDir: string;
  globalConfig?: unknown;
}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Node version
  results.push(checkNodeVersion());

  // 2. Data directory
  results.push(checkDataDir(opts.dataDir));

  // 3. Agents directory
  results.push(checkAgentsDir(opts.agentsDir));

  // 4. Config file
  results.push(checkConfig(opts.globalConfig));

  // 5. API key
  results.push(checkApiKey());

  // 6. Memory store
  results.push(checkMemoryStore(opts.dataDir));

  // 7. Rate limits
  results.push(checkRateLimits(opts.dataDir));

  // 8. Dependencies
  const depResults = await checkDependencies();
  results.push(...depResults);

  return results;
}

function checkNodeVersion(): CheckResult {
  const version = process.version; // e.g. 'v22.1.0'
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 22) {
    return { name: 'Node version', status: 'ok', message: `Node ${version}` };
  }
  return {
    name: 'Node version',
    status: 'error',
    message: `Node ${version} is below minimum`,
    fix: 'Upgrade to Node 22+',
  };
}

function checkDataDir(dataDir: string): CheckResult {
  if (existsSync(dataDir)) {
    return { name: 'Data directory', status: 'ok', message: dataDir };
  }
  return {
    name: 'Data directory',
    status: 'warn',
    message: `${dataDir} does not exist`,
    fix: 'Create directory',
  };
}

function checkAgentsDir(agentsDir: string): CheckResult {
  if (!existsSync(agentsDir)) {
    return {
      name: 'Agents directory',
      status: 'error',
      message: `${agentsDir} does not exist`,
      fix: 'Create agents directory with agent subdirectories',
    };
  }

  try {
    const entries = readdirSync(agentsDir, { withFileTypes: true });
    const subdirs = entries.filter((e) => e.isDirectory());
    if (subdirs.length > 0) {
      return {
        name: 'Agents directory',
        status: 'ok',
        message: `${subdirs.length} agent(s) found`,
      };
    }
    return {
      name: 'Agents directory',
      status: 'error',
      message: `${agentsDir} has no agent subdirectories`,
      fix: 'Add at least one agent subdirectory',
    };
  } catch {
    return {
      name: 'Agents directory',
      status: 'error',
      message: `Cannot read ${agentsDir}`,
      fix: 'Check directory permissions',
    };
  }
}

function checkConfig(globalConfig: unknown): CheckResult {
  if (globalConfig) {
    return { name: 'Config file', status: 'ok', message: 'Config loaded' };
  }
  return {
    name: 'Config file',
    status: 'error',
    message: 'No global config found',
    fix: 'Create config.yml',
  };
}

function checkApiKey(): CheckResult {
  if (process.env.ANTHROPIC_API_KEY) {
    return { name: 'API key', status: 'ok', message: 'ANTHROPIC_API_KEY is set' };
  }
  return {
    name: 'API key',
    status: 'error',
    message: 'ANTHROPIC_API_KEY not set',
    fix: 'Set ANTHROPIC_API_KEY',
  };
}

function checkMemoryStore(dataDir: string): CheckResult {
  const dbPath = join(dataDir, 'memory.db');
  if (existsSync(dbPath)) {
    return { name: 'Memory store', status: 'ok', message: 'memory.db exists' };
  }
  return {
    name: 'Memory store',
    status: 'warn',
    message: 'Memory store not yet created',
  };
}

function checkRateLimits(dataDir: string): CheckResult {
  const filePath = join(dataDir, 'rate-limits.json');
  if (existsSync(filePath)) {
    return { name: 'Rate limits', status: 'ok', message: 'rate-limits.json exists' };
  }
  return {
    name: 'Rate limits',
    status: 'ok',
    message: 'rate-limits.json not found (will be created)',
  };
}

async function checkDependencies(): Promise<CheckResult[]> {
  const packages = ['pino', 'zod', 'better-sqlite3'] as const;
  const results: CheckResult[] = [];

  for (const pkg of packages) {
    try {
      await import(pkg);
      results.push({
        name: `Dependency: ${pkg}`,
        status: 'ok',
        message: `${pkg} is importable`,
      });
    } catch {
      results.push({
        name: `Dependency: ${pkg}`,
        status: 'error',
        message: `${pkg} cannot be imported`,
        fix: `Run: npm install ${pkg}`,
      });
    }
  }

  return results;
}
