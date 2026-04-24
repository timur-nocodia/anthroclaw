import { NextRequest } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { addServer } from '@/lib/fleet';
import type { FleetServer } from '@/lib/fleet';
import { deployGateway } from '@/lib/deploy';
import type { DeployConfig, DeployEvent } from '@/lib/deploy';

/* ------------------------------------------------------------------ */
/*  SSE helper                                                         */
/* ------------------------------------------------------------------ */

function sseEncode(event: DeployEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/* ------------------------------------------------------------------ */
/*  Route handler                                                      */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  let config: DeployConfig;
  try {
    config = (await req.json()) as DeployConfig;
  } catch {
    return Response.json(
      { error: 'validation_error', message: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // Basic validation
  if (
    !config.identity?.name ||
    !config.target?.host ||
    !config.release?.version ||
    !config.release?.repo
  ) {
    return Response.json(
      {
        error: 'validation_error',
        message: 'Required: identity.name, target.host, release.version, release.repo',
      },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let deployUrl = '';

      try {
        for await (const event of deployGateway(config)) {
          controller.enqueue(encoder.encode(sseEncode(event)));

          // After successful deploy, auto-add to fleet
          if (event.type === 'done') {
            deployUrl = event.url;

            const serverId = config.identity.name
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-');

            const newServer: FleetServer = {
              id: serverId,
              name: config.identity.name,
              city: config.identity.city,
              environment: config.identity.environment as FleetServer['environment'],
              region: config.identity.region,
              tags: config.identity.tags ?? [],
              url: deployUrl,
              apiKey: 'pending', // The admin should set this after first login
              ssh: {
                host: config.target.host,
                port: config.target.port,
                user: config.target.user,
                keyEncrypted: config.target.sshKey,
              },
              release: {
                version: config.release.version,
                repo: config.release.repo,
                upgradePolicy: config.release.upgradePolicy,
              },
              policies: config.policies,
              deployedAt: new Date().toISOString(),
            };

            try {
              addServer(newServer);
            } catch {
              // Server already exists — that is fine (re-deploy)
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Deploy failed';
        controller.enqueue(
          encoder.encode(sseEncode({ type: 'error', step: 0, message: msg })),
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
