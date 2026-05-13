import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpassword123';

vi.mock('@/lib/require-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/require-auth')>('@/lib/require-auth');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ email: 'admin@test.com', authMethod: 'cookie' }),
  };
});

let tmpRoot: string;
let fakeUiRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'buildroom-ui-api-'));
  fakeUiRoot = join(tmpRoot, 'ui');
  mkdirSync(fakeUiRoot, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(fakeUiRoot);
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('GET /api/buildroom/status', () => {
  it('returns not_initialized instead of a filesystem error when config is missing', async () => {
    const { GET } = await import('@/app/api/buildroom/status/route');

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      command: 'status',
      initialized: false,
      roomId: 'anthroclaw-core',
      state: {
        roomState: 'not_initialized',
        mode: 'off',
      },
      nextActions: ['anthroclaw buildroom init'],
    });
  });
});

describe('POST /api/buildroom/init', () => {
  it('initializes local Buildroom state and returns canonical status', async () => {
    const { POST } = await import('@/app/api/buildroom/init/route');

    const res = await POST(jsonRequest('/api/buildroom/init', {}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      command: 'status',
      roomId: 'anthroclaw-core',
      state: {
        roomState: 'idle',
        mode: 'manual_approval',
        paused: false,
        killSwitchActive: false,
      },
    });
  });

  it('returns Buildroom command errors without rewriting them as server errors', async () => {
    const { POST } = await import('@/app/api/buildroom/init/route');
    await POST(jsonRequest('/api/buildroom/init', {}));

    const res = await POST(jsonRequest('/api/buildroom/init', {}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: 'buildroom_command_failed',
      },
    });
  });
});

describe('POST /api/buildroom/pause and /resume', () => {
  it('pauses and resumes through the canonical Buildroom command path', async () => {
    const initRoute = await import('@/app/api/buildroom/init/route');
    await initRoute.POST(jsonRequest('/api/buildroom/init', {}));

    const pauseRoute = await import('@/app/api/buildroom/pause/route');
    const paused = await pauseRoute.POST();
    expect(paused.status).toBe(200);
    await expect(paused.json()).resolves.toMatchObject({
      state: {
        roomState: 'paused',
        paused: true,
      },
    });

    const resumeRoute = await import('@/app/api/buildroom/resume/route');
    const resumed = await resumeRoute.POST();
    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({
      state: {
        roomState: 'idle',
        paused: false,
      },
    });
  });
});

describe('POST /api/buildroom/mode and /kill-switch', () => {
  it('updates mode and kill switch through Buildroom commands', async () => {
    const initRoute = await import('@/app/api/buildroom/init/route');
    await initRoute.POST(jsonRequest('/api/buildroom/init', {}));

    const modeRoute = await import('@/app/api/buildroom/mode/route');
    const modeRes = await modeRoute.POST(jsonRequest('/api/buildroom/mode', { mode: 'off' }));
    expect(modeRes.status).toBe(200);
    await expect(modeRes.json()).resolves.toMatchObject({
      state: {
        roomState: 'blocked',
        mode: 'off',
      },
    });

    const killRoute = await import('@/app/api/buildroom/kill-switch/route');
    const killRes = await killRoute.POST(jsonRequest('/api/buildroom/kill-switch', { active: true }));
    expect(killRes.status).toBe(200);
    await expect(killRes.json()).resolves.toMatchObject({
      state: {
        roomState: 'blocked',
        killSwitchActive: true,
      },
    });
  });
});

describe('GET/PATCH /api/buildroom/config', () => {
  it('returns not_initialized when config is missing', async () => {
    const { GET } = await import('@/app/api/buildroom/config/route');

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      initialized: false,
      config: null,
    });
  });

  it('updates safe config fields and validates the resulting Buildroom config', async () => {
    const initRoute = await import('@/app/api/buildroom/init/route');
    await initRoute.POST(jsonRequest('/api/buildroom/init', {}));

    const { GET, PATCH } = await import('@/app/api/buildroom/config/route');
    const patch = await PATCH(jsonRequest('/api/buildroom/config', {
      watch: {
        sessions: true,
        external: true,
      },
      paths: {
        allowed: ['docs/Auto-Buildroom/examples/**', 'tests/fixtures/auto-buildroom/**'],
        blocked: ['.env', '.env.*', 'agents/**', 'data/**'],
      },
      budgets: {
        maxIdeasPerDay: 3,
        maxBuildsPerDay: 1,
        maxActiveBuilds: 1,
        maxRuntimeMinutesPerStage: 15,
      },
      operators: [
        {
          id: 'telegram_user:48705953',
          commandRoutes: ['cli:local', 'telegram_chat:-1003931616911'],
          approvalRoutes: ['cli:local'],
        },
      ],
      notifications: {
        routes: ['telegram_thread:-1003931616911:2'],
      },
    }));

    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toMatchObject({
      ok: true,
      initialized: true,
      config: {
        watch: {
          sessions: { enabled: true },
          rawTranscripts: { enabled: false },
          external: { enabled: true },
        },
        budgets: {
          maxIdeasPerDay: 3,
          maxRuntimeMinutesPerStage: 15,
        },
        operators: [
          {
            id: 'telegram_user:48705953',
            commandRoutes: ['cli:local', 'telegram_chat:-1003931616911'],
          },
        ],
        notifications: {
          routes: ['telegram_thread:-1003931616911:2'],
        },
      },
    });

    const readBack = await GET();
    await expect(readBack.json()).resolves.toMatchObject({
      config: {
        watch: { sessions: { enabled: true } },
        budgets: { maxIdeasPerDay: 3 },
      },
    });
  });

  it('rejects raw transcript enablement through the UI config API', async () => {
    const initRoute = await import('@/app/api/buildroom/init/route');
    await initRoute.POST(jsonRequest('/api/buildroom/init', {}));
    const { PATCH } = await import('@/app/api/buildroom/config/route');

    const res = await PATCH(jsonRequest('/api/buildroom/config', {
      watch: { rawTranscripts: true },
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      error: 'raw_transcripts_not_supported',
    });
  });
});

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
