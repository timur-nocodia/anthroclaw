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

    fireEvent.change(screen.getByLabelText(/mode/i), { target: { value: 'off' } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/buildroom/mode', expect.objectContaining({
        body: JSON.stringify({ mode: 'off' }),
      }));
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
