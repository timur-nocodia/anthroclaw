import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuildroomOverview } from '@/components/buildroom/BuildroomOverview';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('<BuildroomOverview />', () => {
  it('renders not initialized state and initializes Buildroom from the cockpit', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return jsonResponse(statusPayload({ initialized: false, roomState: 'not_initialized', mode: 'off' }));
      }
      if (url.endsWith('/init')) {
        expect(init?.method).toBe('POST');
        return jsonResponse(statusPayload({ initialized: true, roomState: 'idle', mode: 'manual_approval' }));
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BuildroomOverview serverId="local" />);

    expect(await screen.findByText('Buildroom is not initialized')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /initialize/i }));

    await waitFor(() => {
      expect(screen.getAllByText('manual_approval').length).toBeGreaterThan(0);
      expect(screen.getByText('ready')).toBeInTheDocument();
    });
  });

  it('pauses, resumes, toggles kill switch, and changes mode through API actions', async () => {
    const states = [
      statusPayload({ initialized: true, roomState: 'idle', mode: 'manual_approval' }),
      statusPayload({ initialized: true, roomState: 'paused', mode: 'manual_approval', paused: true }),
      statusPayload({ initialized: true, roomState: 'idle', mode: 'manual_approval' }),
      statusPayload({ initialized: true, roomState: 'blocked', mode: 'manual_approval', killSwitchActive: true }),
      statusPayload({ initialized: true, roomState: 'blocked', mode: 'off', killSwitchActive: true }),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/status')) return jsonResponse(states[0]);
      if (url.endsWith('/pause')) {
        expect(init?.method).toBe('POST');
        return jsonResponse(states[1]);
      }
      if (url.endsWith('/resume')) return jsonResponse(states[2]);
      if (url.endsWith('/kill-switch')) return jsonResponse(states[3]);
      if (url.endsWith('/mode')) return jsonResponse(states[4]);
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BuildroomOverview serverId="local" />);

    fireEvent.click(await screen.findByRole('button', { name: /pause/i }));
    await waitFor(() => {
      expect(screen.getAllByText('paused').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(await screen.findByText('ready')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /kill switch on/i }));
    await waitFor(() => {
      expect(screen.getAllByText('active').length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Mode' }), { target: { value: 'off' } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/buildroom/mode', expect.objectContaining({
        body: JSON.stringify({ mode: 'off' }),
      }));
    });
  });

  it('explains Buildroom concepts and exposes hover hints for controls and metrics', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return jsonResponse(statusPayload({ initialized: true, roomState: 'idle', mode: 'manual_approval' }));
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BuildroomOverview serverId="local" />);

    expect(await screen.findByText(/Buildroom turns agent suggestions into scoped, approvable work/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Approval grants authority/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/What does Mode mean/i)[0]).toHaveAttribute('title', expect.stringContaining('manual_approval'));
    expect(screen.getByLabelText(/What does Trust mean/i)).toHaveAttribute('title', expect.stringContaining('QA'));
    expect(screen.getByLabelText(/What does Kill switch mean/i)).toHaveAttribute('title', expect.stringContaining('blocks'));
  });

  it('describes every settings group and exposes hover hints for setting fields', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return jsonResponse(statusPayload({ initialized: true, roomState: 'idle', mode: 'manual_approval' }));
      }
      if (url.endsWith('/config')) {
        return jsonResponse({
          ok: true,
          initialized: true,
          config: configPayload({ sessions: false, maxIdeasPerDay: 5 }),
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BuildroomOverview serverId="local" />);

    fireEvent.click(await screen.findByRole('button', { name: /settings/i }));
    expect(await screen.findByText(/These settings define what Buildroom may observe/i)).toBeInTheDocument();
    expect(screen.getByText(/Watch sources decide what can become evidence/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/What does Raw transcripts mean/i)).toHaveAttribute('title', expect.stringContaining('disabled'));
    expect(screen.getByLabelText(/What does Allowed paths mean/i)).toHaveAttribute('title', expect.stringContaining('write'));
    expect(screen.getByLabelText(/What does Max builds per day mean/i)).toHaveAttribute('title', expect.stringContaining('safety budget'));
  });

  it('renders safe settings and saves config patches without raw transcript access', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return jsonResponse(statusPayload({ initialized: true, roomState: 'idle', mode: 'manual_approval' }));
      }
      if (url.endsWith('/config') && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toMatchObject({
          watch: {
            repo: true,
            docs: true,
            tests: true,
            sessions: true,
            external: false,
          },
          paths: {
            allowed: ['docs/**'],
            blocked: ['.env', 'agents/**'],
          },
          budgets: {
            maxIdeasPerDay: 7,
            maxBuildsPerDay: 1,
          },
          notifications: {
            routes: ['telegram_thread:-1003931616911:2'],
          },
        });
        expect(String(init.body)).not.toContain('rawTranscripts');
        return jsonResponse({
          ok: true,
          initialized: true,
          config: configPayload({ sessions: true, maxIdeasPerDay: 7 }),
        });
      }
      if (url.endsWith('/config')) {
        return jsonResponse({
          ok: true,
          initialized: true,
          config: configPayload({ sessions: false, maxIdeasPerDay: 5 }),
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BuildroomOverview serverId="local" />);

    fireEvent.click(await screen.findByRole('button', { name: /settings/i }));
    expect((await screen.findAllByText(/Watch sources/i)).length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox', { name: /raw transcripts/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /session summaries/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /allowed paths/i }), { target: { value: 'docs/**' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /max ideas per day/i }), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/buildroom/config', expect.objectContaining({
        method: 'PATCH',
      }));
      expect(screen.getByText('Settings saved')).toBeInTheDocument();
    });
  });
});

function statusPayload(opts: {
  initialized: boolean;
  roomState: string;
  mode: string;
  paused?: boolean;
  killSwitchActive?: boolean;
}) {
  return {
    ok: true,
    command: 'status',
    initialized: opts.initialized,
    roomId: 'anthroclaw-core',
    state: {
      roomState: opts.roomState,
      mode: opts.mode,
      paused: opts.paused ?? false,
      killSwitchActive: opts.killSwitchActive ?? false,
      latestTrust: 'none',
      counts: {
        pendingApprovals: 0,
        approvedNotBuilt: 0,
        activeBuilds: 0,
        qaPending: 0,
        trustPending: 0,
        unresolvedErrors: 0,
        complete: 0,
      },
    },
    artifacts: [],
    nextActions: ['anthroclaw buildroom collect'],
  };
}

function configPayload(opts: { sessions: boolean; maxIdeasPerDay: number }) {
  return {
    schemaVersion: 'auto-buildroom/v1',
    roomId: 'anthroclaw-core',
    mode: 'manual_approval',
    paused: false,
    killSwitchActive: false,
    operators: [
      {
        id: 'cli:user:local-operator',
        commandRoutes: ['cli:local'],
        approvalRoutes: ['cli:local'],
      },
    ],
    watch: {
      repo: { enabled: true },
      docs: { enabled: true },
      tests: { enabled: true },
      sessions: { enabled: opts.sessions },
      rawTranscripts: { enabled: false },
      external: { enabled: false },
    },
    paths: {
      allowed: ['docs/**'],
      blocked: ['.env', 'agents/**'],
    },
    execution: {
      mutationTarget: 'worktree',
      allowInPlaceDocsTests: false,
      requireApprovalForBuild: true,
      consumeApprovalOnBuildStart: true,
      retryRequiresOperatorCommand: true,
    },
    external: {
      readOnlyResearch: { enabled: false },
      sideEffects: { default: 'deny' },
    },
    notifications: {
      routes: ['telegram_thread:-1003931616911:2'],
    },
    budgets: {
      maxIdeasPerDay: opts.maxIdeasPerDay,
      maxBuildsPerDay: 1,
      maxActiveBuilds: 1,
      maxRuntimeMinutesPerStage: 20,
    },
  };
}
