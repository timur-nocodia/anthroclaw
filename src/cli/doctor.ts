import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadAgentYml } from '../config/loader.js';
import { discoverPluginCatalog, PluginInstallStore, runPluginDoctor } from '../plugins/index.js';

export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export async function runDiagnostics(opts: {
  dataDir: string;
  agentsDir: string;
  pluginsDir?: string;
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

  // 5. Legacy fallback auth
  results.push(checkLegacyFallbackAuth());

  // 6. Learning admin approvals
  results.push(checkLearningAdminApprovals(opts.agentsDir));

  // 7. Memory store
  results.push(checkMemoryStore(opts.dataDir));

  // 8. Rate limits
  results.push(checkRateLimits(opts.dataDir));

  // 9. Dependencies
  const depResults = await checkDependencies();
  results.push(...depResults);

  if (opts.pluginsDir) {
    const pluginResults = await checkPlugins(opts.dataDir, opts.pluginsDir);
    results.push(...pluginResults);
  }

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

function checkLegacyFallbackAuth(): CheckResult {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { name: 'Legacy fallback auth', status: 'ok', message: 'CLAUDE_CODE_OAUTH_TOKEN is set' };
  }

  if (existsSync(join(homedir(), '.claude'))) {
    return { name: 'Legacy fallback auth', status: 'ok', message: '~/.claude exists' };
  }

  return {
    name: 'Legacy fallback auth',
    status: 'warn',
    message: 'Legacy fallback credentials not found; Runtime v1 / Pi does not require them',
    fix: 'Configure Runtime providers for normal agent calls. Add legacy fallback credentials only if rollback diagnostics need them.',
  };
}

function checkLearningAdminApprovals(agentsDir: string): CheckResult {
  if (!existsSync(agentsDir)) {
    return { name: 'Learning admin approvals', status: 'ok', message: 'Agents directory missing; skipped' };
  }

  const findings: string[] = [];
  let inspected = 0;
  for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    inspected += 1;
    const agentId = entry.name;
    const agentDir = join(agentsDir, agentId);
    const agentYmlPath = join(agentDir, 'agent.yml');
    if (!existsSync(agentYmlPath)) continue;

    try {
      const config = loadAgentYml(agentDir);
      const admin = config.learning.approvals.admin;
      if (!admin.notify || admin.routes.length === 0) continue;
      for (const route of admin.routes) {
        const sendersByAccount = admin.senders[route.channel] ?? {};
        const allowed = route.account_id
          ? sendersByAccount[route.account_id] ?? []
          : Object.values(sendersByAccount).flat();
        if (allowed.length === 0) {
          const account = route.account_id ?? '*';
          findings.push(`${agentId}: ${route.channel}/${account} has admin approval delivery but no sender allowlist`);
        }
      }
    } catch (err) {
      findings.push(`${agentId}: cannot inspect agent.yml (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  if (findings.length > 0) {
    return {
      name: 'Learning admin approvals',
      status: 'warn',
      message: findings.join('; '),
      fix: 'Add learning.approvals.admin.senders.<channel>.<account_id> operator sender IDs, or disable learning.approvals.admin.notify.',
    };
  }

  return {
    name: 'Learning admin approvals',
    status: 'ok',
    message: inspected === 0 ? 'No agents found' : 'No missing admin sender allowlists',
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

async function checkPlugins(dataDir: string, pluginsDir: string): Promise<CheckResult[]> {
  const managedDir = join(dataDir, 'plugins-installed');
  const store = new PluginInstallStore(join(dataDir, 'plugin-installs.json'));
  const catalog = await discoverPluginCatalog({
    bundledDir: pluginsDir,
    managedDir,
    installRecords: store.list(),
  });
  return runPluginDoctor({ catalog, managedDir });
}
