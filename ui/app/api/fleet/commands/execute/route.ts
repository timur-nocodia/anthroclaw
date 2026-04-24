import { NextRequest } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { getServer, loadFleet } from '@/lib/fleet';
import type { FleetServer } from '@/lib/fleet';
import { proxyRequest } from '@/lib/fleet-proxy';
import { sshExec } from '@/lib/ssh';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CommandEvent =
  | { type: 'progress'; serverId: string; serverName: string; status: 'running' | 'done' | 'error'; message?: string }
  | { type: 'done'; summary: { total: number; succeeded: number; failed: number } }
  | { type: 'error'; message: string };

interface CommandRequest {
  command: string;
  targetServerIds: string[];
  options?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  SSE helper                                                         */
/* ------------------------------------------------------------------ */

function sseEncode(event: CommandEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/* ------------------------------------------------------------------ */
/*  Command implementations                                            */
/* ------------------------------------------------------------------ */

async function* rollingRestart(
  servers: FleetServer[],
): AsyncGenerator<CommandEvent> {
  for (const server of servers) {
    yield { type: 'progress', serverId: server.id, serverName: server.name, status: 'running', message: 'Restarting gateway...' };

    try {
      if (server.ssh) {
        const serviceName = `anthroclaw-${server.id}`;
        await sshExec(server, `sudo systemctl restart ${serviceName}`);

        // Wait for healthy (poll up to 30s)
        const healthUrl = `${server.url}/api/gateway/status`;
        for (let i = 0; i < 15; i++) {
          try {
            const res = await fetch(healthUrl, {
              headers: server.apiKey !== 'self' ? { Authorization: `Bearer ${server.apiKey}` } : {},
              signal: AbortSignal.timeout(3000),
            });
            if (res.ok) break;
          } catch { /* retry */ }
          await sleep(2000);
        }
      } else {
        // No SSH — use API to request restart
        await proxyRequest(server.id, 'gateway/restart', 'POST', { 'Content-Type': 'application/json' });
        await sleep(5000);
      }

      yield { type: 'progress', serverId: server.id, serverName: server.name, status: 'done' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Restart failed';
      yield { type: 'progress', serverId: server.id, serverName: server.name, status: 'error', message: msg };
    }
  }
}

async function* hotReload(
  servers: FleetServer[],
): AsyncGenerator<CommandEvent> {
  // Parallel: fire all, then collect
  const promises = servers.map(async (server): Promise<CommandEvent[]> => {
    const events: CommandEvent[] = [];
    events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'running', message: 'Sending hot-reload...' });

    try {
      const res = await proxyRequest(server.id, 'gateway/reload', 'POST', { 'Content-Type': 'application/json' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'done' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reload failed';
      events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'error', message: msg });
    }

    return events;
  });

  const results = await Promise.all(promises);
  for (const events of results) {
    for (const event of events) {
      yield event;
    }
  }
}

async function* pullRedeploy(
  servers: FleetServer[],
): AsyncGenerator<CommandEvent> {
  for (const server of servers) {
    yield { type: 'progress', serverId: server.id, serverName: server.name, status: 'running', message: 'Pulling latest code...' };

    try {
      if (!server.ssh) throw new Error('No SSH config — cannot pull-redeploy');

      const appDir = `/opt/anthroclaw/${server.id}`;
      const serviceName = `anthroclaw-${server.id}`;

      await sshExec(server, `cd ${appDir} && git pull --ff-only`);
      await sshExec(server, `cd ${appDir} && pnpm install --frozen-lockfile`);
      await sshExec(server, `sudo systemctl restart ${serviceName}`);

      // Wait for healthy
      await sleep(5000);

      yield { type: 'progress', serverId: server.id, serverName: server.name, status: 'done' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Pull-redeploy failed';
      yield { type: 'progress', serverId: server.id, serverName: server.name, status: 'error', message: msg };
    }
  }
}

async function* syncAgents(
  servers: FleetServer[],
  options: Record<string, unknown>,
): AsyncGenerator<CommandEvent> {
  const sourceServerId = (options.sourceServerId as string) ?? 'local';

  // Fetch agent list from source
  let agentList: string[];
  try {
    const res = await proxyRequest(sourceServerId, 'agents', 'GET', { Accept: 'application/json' });
    if (!res.ok) throw new Error(`Failed to fetch agents from source: HTTP ${res.status}`);
    const data = await res.json() as Array<{ id: string }>;
    agentList = data.map((a) => a.id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch agents';
    yield { type: 'error', message: msg };
    return;
  }

  // Sync to each target in parallel
  const promises = servers.map(async (server): Promise<CommandEvent[]> => {
    const events: CommandEvent[] = [];
    events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'running', message: `Syncing ${agentList.length} agents...` });

    try {
      for (const agentId of agentList) {
        // GET agent from source
        const agentRes = await proxyRequest(sourceServerId, `agents/${agentId}`, 'GET', { Accept: 'application/json' });
        if (!agentRes.ok) continue;
        const agentData = await agentRes.text();

        // PUT agent to target
        const putRes = await proxyRequest(server.id, `agents/${agentId}`, 'PUT', { 'Content-Type': 'application/json' }, agentData);
        if (!putRes.ok) throw new Error(`Failed to sync agent ${agentId}: HTTP ${putRes.status}`);
      }

      events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'done', message: `Synced ${agentList.length} agents` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'error', message: msg });
    }

    return events;
  });

  const results = await Promise.all(promises);
  for (const events of results) {
    for (const event of events) {
      yield event;
    }
  }
}

async function* backup(
  servers: FleetServer[],
): AsyncGenerator<CommandEvent> {
  const promises = servers.map(async (server): Promise<CommandEvent[]> => {
    const events: CommandEvent[] = [];
    events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'running', message: 'Triggering backup...' });

    try {
      const res = await proxyRequest(server.id, 'gateway/backup', 'POST', { 'Content-Type': 'application/json' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'done' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Backup failed';
      events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'error', message: msg });
    }

    return events;
  });

  const results = await Promise.all(promises);
  for (const events of results) {
    for (const event of events) {
      yield event;
    }
  }
}

async function* rotateKeys(
  servers: FleetServer[],
): AsyncGenerator<CommandEvent> {
  for (const server of servers) {
    yield { type: 'progress', serverId: server.id, serverName: server.name, status: 'running', message: 'Rotating JWT secret...' };

    try {
      if (!server.ssh) throw new Error('No SSH config — cannot rotate keys');

      const appDir = `/opt/anthroclaw/${server.id}`;
      const serviceName = `anthroclaw-${server.id}`;

      // Generate new JWT secret
      const newSecret = randomHex(32);

      await sshExec(
        server,
        `cd ${appDir} && sed -i 's/^JWT_SECRET=.*/JWT_SECRET=${newSecret}/' .env`,
      );
      await sshExec(server, `sudo systemctl restart ${serviceName}`);
      await sleep(3000);

      yield { type: 'progress', serverId: server.id, serverName: server.name, status: 'done' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Key rotation failed';
      yield { type: 'progress', serverId: server.id, serverName: server.name, status: 'error', message: msg };
    }
  }
}

async function* stopFleet(
  servers: FleetServer[],
): AsyncGenerator<CommandEvent> {
  const promises = servers.map(async (server): Promise<CommandEvent[]> => {
    const events: CommandEvent[] = [];
    events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'running', message: 'Stopping gateway...' });

    try {
      const res = await proxyRequest(server.id, 'gateway/stop', 'POST', { 'Content-Type': 'application/json' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'done' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Stop failed';
      events.push({ type: 'progress', serverId: server.id, serverName: server.name, status: 'error', message: msg });
    }

    return events;
  });

  const results = await Promise.all(promises);
  for (const events of results) {
    for (const event of events) {
      yield event;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

const COMMANDS: Record<
  string,
  (servers: FleetServer[], options: Record<string, unknown>) => AsyncGenerator<CommandEvent>
> = {
  rolling_restart: (s) => rollingRestart(s),
  hot_reload: (s) => hotReload(s),
  pull_redeploy: (s) => pullRedeploy(s),
  sync_agents: (s, o) => syncAgents(s, o),
  backup: (s) => backup(s),
  rotate_keys: (s) => rotateKeys(s),
  stop_fleet: (s) => stopFleet(s),
};

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  let body: CommandRequest;
  try {
    body = (await req.json()) as CommandRequest;
  } catch {
    return Response.json(
      { error: 'validation_error', message: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const { command, targetServerIds, options } = body;

  if (!command || !Array.isArray(targetServerIds) || targetServerIds.length === 0) {
    return Response.json(
      { error: 'validation_error', message: 'command and targetServerIds[] are required' },
      { status: 400 },
    );
  }

  const commandFn = COMMANDS[command];
  if (!commandFn) {
    return Response.json(
      { error: 'validation_error', message: `Unknown command: ${command}` },
      { status: 400 },
    );
  }

  // Resolve servers
  const allServers = loadFleet();
  const servers: FleetServer[] = [];
  for (const id of targetServerIds) {
    const srv = allServers.find((s) => s.id === id);
    if (!srv) {
      return Response.json(
        { error: 'not_found', message: `Server '${id}' not found` },
        { status: 404 },
      );
    }
    servers.push(srv);
  }

  // Stream SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let succeeded = 0;
      let failed = 0;

      try {
        const gen = commandFn(servers, options ?? {});
        for await (const event of gen) {
          controller.enqueue(encoder.encode(sseEncode(event)));

          if (event.type === 'progress') {
            if (event.status === 'done') succeeded++;
            else if (event.status === 'error') failed++;
          }
        }

        const summary: CommandEvent = {
          type: 'done',
          summary: { total: servers.length, succeeded, failed },
        };
        controller.enqueue(encoder.encode(sseEncode(summary)));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Command execution failed';
        controller.enqueue(
          encoder.encode(sseEncode({ type: 'error', message: msg })),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
