import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { HookEmitter, type HookConfig } from '../../src/hooks/emitter.js';

// ─── Test helpers ─────────────────────────────────────────────────

function makeWebhookHook(overrides: Partial<HookConfig> = {}): HookConfig {
  return {
    event: 'on_message_received',
    action: 'webhook',
    url: 'http://localhost:19876/hook',
    timeout_ms: 5000,
    ...overrides,
  };
}

function makeScriptHook(overrides: Partial<HookConfig> = {}): HookConfig {
  return {
    event: 'on_message_received',
    action: 'script',
    command: 'echo $HOOK_AGENTID',
    timeout_ms: 5000,
    ...overrides,
  };
}

// ─── Webhook hooks ────────────────────────────────────────────────

describe('HookEmitter — webhook', () => {
  let server: Server;
  let receivedBodies: string[];
  let serverPort: number;

  beforeEach(async () => {
    receivedBodies = [];
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        receivedBodies.push(body);
        res.writeHead(200);
        res.end('ok');
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 19876;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fires a POST request to the webhook URL', async () => {
    const hook = makeWebhookHook({ url: `http://localhost:${serverPort}/hook` });
    const emitter = new HookEmitter([hook]);

    await emitter.emit('on_message_received', { agentId: 'bot-a', text: 'hello' });

    // Give the fire-and-forget fetch a moment to land
    await new Promise((r) => setTimeout(r, 100));

    expect(receivedBodies).toHaveLength(1);
    const parsed = JSON.parse(receivedBodies[0]);
    expect(parsed.agentId).toBe('bot-a');
    expect(parsed.text).toBe('hello');
  });

  it('does not fire webhook for non-matching event', async () => {
    const hook = makeWebhookHook({
      event: 'on_after_query',
      url: `http://localhost:${serverPort}/hook`,
    });
    const emitter = new HookEmitter([hook]);

    await emitter.emit('on_message_received', { agentId: 'bot-a' });

    await new Promise((r) => setTimeout(r, 100));
    expect(receivedBodies).toHaveLength(0);
  });

  it('handles webhook timeout without throwing', async () => {
    // Create a server that never responds
    const slowServer = createServer(() => {
      // intentionally never respond
    });
    await new Promise<void>((resolve) => {
      slowServer.listen(0, () => resolve());
    });
    const slowPort = (slowServer.address() as { port: number }).port;

    const hook = makeWebhookHook({
      url: `http://localhost:${slowPort}/hook`,
      timeout_ms: 200,
    });
    const emitter = new HookEmitter([hook]);

    // Should not throw even though the request times out
    await expect(
      emitter.emit('on_message_received', { agentId: 'bot-a' }),
    ).resolves.toBeUndefined();

    await new Promise<void>((resolve) => slowServer.close(() => resolve()));
  });

  it('handles webhook connection error without throwing', async () => {
    // Use a port that nothing is listening on
    const hook = makeWebhookHook({
      url: 'http://localhost:19999/nonexistent',
      timeout_ms: 1000,
    });
    const emitter = new HookEmitter([hook]);

    await expect(
      emitter.emit('on_message_received', { data: 'test' }),
    ).resolves.toBeUndefined();
  });
});

// ─── Script hooks ─────────────────────────────────────────────────

describe('HookEmitter — script', () => {
  it('spawns a shell command with env vars from payload', async () => {
    // Write payload env vars to a temp file so we can verify
    const tmpFile = `/tmp/hook-test-${Date.now()}.txt`;
    const hook = makeScriptHook({
      command: `echo "$HOOK_AGENTID|$HOOK_TEXT" > ${tmpFile}`,
    });
    const emitter = new HookEmitter([hook]);

    await emitter.emit('on_message_received', { agentId: 'bot-x', text: 'hi' });

    // Wait for the script to complete
    await new Promise((r) => setTimeout(r, 500));

    const { readFileSync, unlinkSync } = await import('node:fs');
    const content = readFileSync(tmpFile, 'utf-8').trim();
    expect(content).toBe('bot-x|hi');
    unlinkSync(tmpFile);
  });

  it('does not fire script for non-matching event', async () => {
    const tmpFile = `/tmp/hook-test-nomatch-${Date.now()}.txt`;
    const hook = makeScriptHook({
      event: 'on_cron_fire',
      command: `echo "fired" > ${tmpFile}`,
    });
    const emitter = new HookEmitter([hook]);

    await emitter.emit('on_message_received', { agentId: 'bot-a' });

    await new Promise((r) => setTimeout(r, 300));

    const { existsSync } = await import('node:fs');
    expect(existsSync(tmpFile)).toBe(false);
  });

  it('handles script failure without throwing', async () => {
    const hook = makeScriptHook({
      command: 'exit 1',
    });
    const emitter = new HookEmitter([hook]);

    await expect(
      emitter.emit('on_message_received', { data: 'test' }),
    ).resolves.toBeUndefined();
  });

  it('handles script timeout without throwing', async () => {
    const hook = makeScriptHook({
      command: 'sleep 10',
      timeout_ms: 200,
    });
    const emitter = new HookEmitter([hook]);

    await expect(
      emitter.emit('on_message_received', { data: 'test' }),
    ).resolves.toBeUndefined();
  });
});

// ─── Multiple hooks / mixed ────────────────────────────────────────

describe('HookEmitter — multiple hooks', () => {
  it('fires multiple hooks for the same event', async () => {
    const tmpFile1 = `/tmp/hook-multi-1-${Date.now()}.txt`;
    const tmpFile2 = `/tmp/hook-multi-2-${Date.now()}.txt`;

    const emitter = new HookEmitter([
      makeScriptHook({ command: `echo "a" > ${tmpFile1}` }),
      makeScriptHook({ command: `echo "b" > ${tmpFile2}` }),
    ]);

    await emitter.emit('on_message_received', { agentId: 'bot-a' });

    await new Promise((r) => setTimeout(r, 500));

    const { readFileSync, unlinkSync } = await import('node:fs');
    expect(readFileSync(tmpFile1, 'utf-8').trim()).toBe('a');
    expect(readFileSync(tmpFile2, 'utf-8').trim()).toBe('b');
    unlinkSync(tmpFile1);
    unlinkSync(tmpFile2);
  });

  it('emits nothing when no hooks match', async () => {
    const emitter = new HookEmitter([
      makeScriptHook({ event: 'on_cron_fire' }),
      makeWebhookHook({ event: 'on_after_query' }),
    ]);

    // Should complete immediately without errors
    await expect(
      emitter.emit('on_message_received', { data: 'test' }),
    ).resolves.toBeUndefined();
  });
});
