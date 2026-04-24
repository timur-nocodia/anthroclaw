import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* ------------------------------------------------------------------ */
/*  Setup temp fleet file                                              */
/* ------------------------------------------------------------------ */

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'fleet-proxy-test-'));
  const fleetPath = resolve(tmpDir, 'fleet.json');

  const fleet = [
    {
      id: 'local',
      name: 'Local Gateway',
      environment: 'development',
      region: 'local',
      tags: ['local'],
      url: 'http://localhost:3000',
      apiKey: 'self',
      primary: true,
    },
    {
      id: 'remote-1',
      name: 'Remote Server',
      environment: 'production',
      region: 'eu-west',
      tags: [],
      url: 'https://remote.example.com',
      apiKey: 'secret-key-123',
    },
  ];

  writeFileSync(fleetPath, JSON.stringify(fleet, null, 2));
  process.env.FLEET_FILE_PATH = fleetPath;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FLEET_FILE_PATH;
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Import after env setup                                             */
/* ------------------------------------------------------------------ */

import { proxyRequest } from '@/lib/fleet-proxy';

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('proxyRequest', () => {
  it('forwards to localhost for local server (apiKey=self)', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const res = await proxyRequest('local', 'gateway/status', 'GET', {
      Accept: 'application/json',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/gateway/status');
    expect((opts as RequestInit).method).toBe('GET');
    // Local: no bearer token injected
    expect((opts as RequestInit).headers).toEqual({ Accept: 'application/json' });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });

    fetchSpy.mockRestore();
  });

  it('forwards to remote server with bearer token', async () => {
    const mockResponse = new Response(JSON.stringify({ agents: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await proxyRequest('remote-1', 'agents', 'GET', {
      Accept: 'application/json',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://remote.example.com/api/agents');
    expect((opts as RequestInit).method).toBe('GET');

    // Remote: bearer token injected from server.apiKey
    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-key-123');

    fetchSpy.mockRestore();
  });

  it('forwards POST body to remote server', async () => {
    const mockResponse = new Response('{}', { status: 201 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const body = JSON.stringify({ name: 'test-agent' });
    await proxyRequest('remote-1', 'agents', 'POST', {
      'Content-Type': 'application/json',
    }, body);

    const [, opts] = fetchSpy.mock.calls[0];
    expect((opts as RequestInit).method).toBe('POST');
    expect((opts as RequestInit).body).toBe(body);

    fetchSpy.mockRestore();
  });

  it('throws for unknown server', async () => {
    await expect(
      proxyRequest('nonexistent', 'test', 'GET', {}),
    ).rejects.toThrow('server_not_found');
  });

  it('applies 30s timeout for remote requests', async () => {
    const mockResponse = new Response('{}');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await proxyRequest('remote-1', 'test', 'GET', {});

    const [, opts] = fetchSpy.mock.calls[0];
    expect((opts as RequestInit).signal).toBeDefined();

    fetchSpy.mockRestore();
  });
});
