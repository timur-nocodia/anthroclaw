import { Client } from 'ssh2';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DeployConfig {
  identity: {
    name: string;
    environment: string;
    region: string;
    city?: string;
    tags?: string[];
  };
  target: {
    type: 'ssh';
    host: string;
    port: number;
    user: string;
    authMethod: 'key' | 'password';
    sshKey?: string;
    password?: string;
  };
  networking: {
    domain?: string;
    httpPort: number;
    webhookMode: 'longpoll' | 'webhook';
  };
  release: {
    version: string;
    repo: string;
    upgradePolicy: string;
  };
  agents: {
    source: 'blank' | 'template' | 'git';
    sourceServerId?: string;
    agentIds?: string[];
    gitUrl?: string;
    gitRef?: string;
    channelTokens?: Record<string, string>;
  };
  policies: {
    backup: { schedule: string; destination: string } | null;
    monitoring: boolean;
    logRetention: string;
    maxMediaGB: number;
  };
}

export type DeployEvent =
  | {
      type: 'step';
      index: number;
      total: number;
      label: string;
      status: 'running' | 'done' | 'error';
      elapsed?: number;
      message?: string;
    }
  | { type: 'done'; url: string; credentials: { email: string; note: string } }
  | { type: 'error'; step: number; message: string };

/* ------------------------------------------------------------------ */
/*  SSH helper (internal)                                              */
/* ------------------------------------------------------------------ */

function deploySshExec(
  config: DeployConfig,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (d: Buffer) => {
          stdout += d.toString();
        });

        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });

        stream.on('close', (code: number) => {
          conn.end();
          if (code !== 0) {
            reject(
              new Error(
                `Command exited with code ${code}: ${stderr || stdout}`,
              ),
            );
            return;
          }
          resolve({ stdout, stderr, code });
        });
      });
    });

    conn.on('error', reject);

    conn.connect({
      host: config.target.host,
      port: config.target.port,
      username: config.target.user,
      ...(config.target.sshKey ? { privateKey: config.target.sshKey } : {}),
      ...(config.target.password ? { password: config.target.password } : {}),
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Deploy steps                                                       */
/* ------------------------------------------------------------------ */

const DEPLOY_STEPS = [
  'Connecting via SSH',
  'Installing Node.js 22',
  'Installing pnpm',
  'Cloning repository',
  'Installing dependencies',
  'Configuring environment',
  'Setting up systemd + reverse proxy',
  'Starting and verifying health',
] as const;

async function executeDeployStep(
  config: DeployConfig,
  step: number,
): Promise<void> {
  const appDir = `/opt/anthroclaw/${config.identity.name}`;

  switch (step) {
    case 0: {
      // Step 0: SSH connect test
      await deploySshExec(config, 'echo "Connection OK" && whoami');
      break;
    }

    case 1: {
      // Step 1: Install Node.js 22
      await deploySshExec(
        config,
        [
          'export DEBIAN_FRONTEND=noninteractive',
          'if ! node --version 2>/dev/null | grep -q "v22"; then',
          '  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -',
          '  sudo apt-get install -y nodejs',
          'fi',
          'node --version',
        ].join(' && '),
      );
      break;
    }

    case 2: {
      // Step 2: Install pnpm
      await deploySshExec(
        config,
        [
          'sudo corepack enable',
          'corepack prepare pnpm@latest --activate',
          'pnpm --version',
        ].join(' && '),
      );
      break;
    }

    case 3: {
      // Step 3: Clone repository
      const branch = config.release.version;
      const repo = config.release.repo;
      await deploySshExec(
        config,
        [
          `sudo mkdir -p ${appDir}`,
          `sudo chown $(whoami):$(whoami) ${appDir}`,
          `git clone --depth 1 --branch ${branch} ${repo} ${appDir}`,
        ].join(' && '),
      );
      break;
    }

    case 4: {
      // Step 4: Install dependencies
      await deploySshExec(
        config,
        [`cd ${appDir}`, 'pnpm install --frozen-lockfile'].join(' && '),
      );
      break;
    }

    case 5: {
      // Step 5: Configure environment (.env + config.yml)
      const jwtSecret = randomHex(32);
      const adminPassword = randomHex(16);
      const envVars = [
        `PORT=${config.networking.httpPort}`,
        `JWT_SECRET=${jwtSecret}`,
        'ADMIN_EMAIL=admin@anthroclaw.local',
        `ADMIN_PASSWORD=${adminPassword}`,
        `ENVIRONMENT=${config.identity.environment}`,
        `REGION=${config.identity.region}`,
        config.networking.domain
          ? `DOMAIN=${config.networking.domain}`
          : '',
      ]
        .filter(Boolean)
        .join('\\n');

      await deploySshExec(
        config,
        `printf "${envVars}\\n" > ${appDir}/.env`,
      );

      // Write channel tokens if provided
      if (config.agents.channelTokens) {
        for (const [key, value] of Object.entries(
          config.agents.channelTokens,
        )) {
          await deploySshExec(
            config,
            `echo "${key}=${value}" >> ${appDir}/.env`,
          );
        }
      }
      break;
    }

    case 6: {
      // Step 6: systemd unit + optional Caddy reverse proxy
      const serviceName = `anthroclaw-${config.identity.name}`;
      const unit = [
        '[Unit]',
        `Description=AnthroClaw Gateway - ${config.identity.name}`,
        'After=network.target',
        '',
        '[Service]',
        'Type=simple',
        `WorkingDirectory=${appDir}`,
        `ExecStart=/usr/bin/node ${appDir}/dist/index.js`,
        'Restart=always',
        'RestartSec=5',
        `EnvironmentFile=${appDir}/.env`,
        `User=${config.target.user}`,
        '',
        '[Install]',
        'WantedBy=multi-user.target',
      ].join('\\n');

      await deploySshExec(
        config,
        [
          `printf "${unit}" | sudo tee /etc/systemd/system/${serviceName}.service`,
          'sudo systemctl daemon-reload',
          `sudo systemctl enable ${serviceName}`,
        ].join(' && '),
      );

      // Optional: Caddy reverse proxy for domain
      if (config.networking.domain) {
        const caddyConfig = [
          `${config.networking.domain} {`,
          `  reverse_proxy localhost:${config.networking.httpPort}`,
          '}',
        ].join('\\n');

        await deploySshExec(
          config,
          [
            `printf "${caddyConfig}" | sudo tee /etc/caddy/sites/${config.identity.name}.caddy`,
            'sudo systemctl reload caddy || true',
          ].join(' && '),
        );
      }
      break;
    }

    case 7: {
      // Step 7: Start service + health check
      const serviceName = `anthroclaw-${config.identity.name}`;
      await deploySshExec(
        config,
        `sudo systemctl start ${serviceName}`,
      );

      // Poll for healthy status (up to 30s)
      const healthUrl = config.networking.domain
        ? `https://${config.networking.domain}/api/gateway/status`
        : `http://localhost:${config.networking.httpPort}/api/gateway/status`;

      await deploySshExec(
        config,
        [
          'for i in $(seq 1 15); do',
          `  if curl -sf ${healthUrl} > /dev/null 2>&1; then`,
          '    echo "healthy"',
          '    exit 0',
          '  fi',
          '  sleep 2',
          'done',
          'echo "health check timed out" >&2',
          'exit 1',
        ].join('; '),
      );
      break;
    }

    default:
      throw new Error(`Unknown deploy step: ${step}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Deploy generator                                                   */
/* ------------------------------------------------------------------ */

export async function* deployGateway(
  config: DeployConfig,
): AsyncGenerator<DeployEvent> {
  const total = DEPLOY_STEPS.length;

  for (let i = 0; i < DEPLOY_STEPS.length; i++) {
    yield {
      type: 'step',
      index: i + 1,
      total,
      label: DEPLOY_STEPS[i],
      status: 'running',
    };

    const start = Date.now();

    try {
      await executeDeployStep(config, i);
      yield {
        type: 'step',
        index: i + 1,
        total,
        label: DEPLOY_STEPS[i],
        status: 'done',
        elapsed: Date.now() - start,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown error';
      yield {
        type: 'step',
        index: i + 1,
        total,
        label: DEPLOY_STEPS[i],
        status: 'error',
        message,
      };
      yield { type: 'error', step: i + 1, message };
      return;
    }
  }

  const url = config.networking.domain
    ? `https://${config.networking.domain}`
    : `http://${config.target.host}:${config.networking.httpPort}`;

  yield {
    type: 'done',
    url,
    credentials: {
      email: 'admin@anthroclaw.local',
      note: 'Password in .env on server',
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Dry-run checks                                                     */
/* ------------------------------------------------------------------ */

export interface DryRunCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export async function deployDryRun(
  config: DeployConfig,
): Promise<{ checks: DryRunCheck[]; canDeploy: boolean }> {
  const checks: DryRunCheck[] = [];

  // 1. SSH connectivity
  try {
    await deploySshExec(config, 'echo ok');
    checks.push({ name: 'SSH connectivity', status: 'pass', message: 'Connected successfully' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    checks.push({ name: 'SSH connectivity', status: 'fail', message: msg });
  }

  // 2. Disk space
  try {
    const { stdout } = await deploySshExec(
      config,
      "df -BG / | tail -1 | awk '{print $4}' | tr -d 'G'",
    );
    const freeGB = parseInt(stdout.trim(), 10);
    if (freeGB < 2) {
      checks.push({ name: 'Disk space', status: 'fail', message: `Only ${freeGB}GB free, need at least 2GB` });
    } else if (freeGB < 5) {
      checks.push({ name: 'Disk space', status: 'warn', message: `${freeGB}GB free (low)` });
    } else {
      checks.push({ name: 'Disk space', status: 'pass', message: `${freeGB}GB free` });
    }
  } catch {
    checks.push({ name: 'Disk space', status: 'warn', message: 'Could not check disk space' });
  }

  // 3. Node.js availability
  try {
    const { stdout } = await deploySshExec(config, 'node --version 2>/dev/null || echo "not_installed"');
    if (stdout.trim() === 'not_installed') {
      checks.push({ name: 'Node.js', status: 'warn', message: 'Not installed (will be installed during deploy)' });
    } else {
      checks.push({ name: 'Node.js', status: 'pass', message: `Installed: ${stdout.trim()}` });
    }
  } catch {
    checks.push({ name: 'Node.js', status: 'warn', message: 'Could not check Node.js' });
  }

  // 4. Port availability
  try {
    const { stdout } = await deploySshExec(
      config,
      `ss -tlnp | grep :${config.networking.httpPort} || echo "port_free"`,
    );
    if (stdout.trim() === 'port_free') {
      checks.push({ name: 'Port availability', status: 'pass', message: `Port ${config.networking.httpPort} is free` });
    } else {
      checks.push({ name: 'Port availability', status: 'fail', message: `Port ${config.networking.httpPort} is already in use` });
    }
  } catch {
    checks.push({ name: 'Port availability', status: 'warn', message: 'Could not check port availability' });
  }

  // 5. Domain DNS
  if (config.networking.domain) {
    try {
      const { stdout } = await deploySshExec(
        config,
        `dig +short ${config.networking.domain} A 2>/dev/null || echo "no_dns"`,
      );
      const ip = stdout.trim();
      if (!ip || ip === 'no_dns') {
        checks.push({ name: 'Domain DNS', status: 'warn', message: `No A record found for ${config.networking.domain}` });
      } else {
        checks.push({ name: 'Domain DNS', status: 'pass', message: `Resolves to ${ip}` });
      }
    } catch {
      checks.push({ name: 'Domain DNS', status: 'warn', message: 'Could not check DNS' });
    }
  }

  const canDeploy = !checks.some((c) => c.status === 'fail');
  return { checks, canDeploy };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
