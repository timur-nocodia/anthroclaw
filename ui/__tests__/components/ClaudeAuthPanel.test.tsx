import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClaudeAuthPanel } from '@/components/settings/ClaudeAuthPanel';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('<ClaudeAuthPanel />', () => {
  it('renders connected account status without exposing credential material', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      expect(String(input)).toContain('/api/fleet/local/runtime/legacy/claude/status');
      return jsonResponse({
        connected: true,
        email: 'operator@example.com',
        authMethod: 'claude.ai',
        subscriptionType: 'max',
        runtimeHome: '/home/node',
        credentialFile: { exists: true, updatedAt: '2026-05-13T00:00:00.000Z' },
        pendingSession: null,
        legacyRuntime: true,
        runtimeRole: 'legacy-fallback',
        provider: 'claude-agent-sdk',
      });
    }));

    render(<ClaudeAuthPanel serverId="local" />);

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Legacy Claude fallback auth')).toBeInTheDocument();
    expect(screen.getByText('operator@example.com')).toBeInTheDocument();
    expect(screen.getByText('/home/node')).toBeInTheDocument();
    expect(screen.queryByText(/Claude subscription auth/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect claude subscription/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/sk-ant/i)).not.toBeInTheDocument();
  });

  it('starts login, accepts the returned code, and refreshes status', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return jsonResponse({
          connected: false,
          runtimeHome: '/home/node',
          credentialFile: { exists: false },
          pendingSession: null,
          legacyRuntime: true,
          runtimeRole: 'legacy-fallback',
          provider: 'claude-agent-sdk',
        });
      }
      if (url.endsWith('/start')) {
        return jsonResponse({
          sessionId: 'auth_1',
          status: 'waiting_for_code',
          loginUrl: 'https://claude.com/cai/oauth/authorize?state=[redacted]',
          safeOutput: 'visit url',
        });
      }
      if (url.endsWith('/complete')) {
        expect(init?.body).toContain('browser-code');
        return jsonResponse({
          ok: true,
          restarted: true,
          status: {
            connected: true,
            email: 'operator@example.com',
            runtimeHome: '/home/node',
            credentialFile: { exists: true },
          },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ClaudeAuthPanel serverId="local" />);

    fireEvent.click(await screen.findByRole('button', { name: /connect legacy fallback/i }));
    expect(await screen.findByRole('link', { name: /open authorization page/i })).toHaveAttribute(
      'href',
      'https://claude.com/cai/oauth/authorize?state=[redacted]',
    );
    fireEvent.change(screen.getByLabelText(/authorization code/i), {
      target: { value: 'browser-code' },
    });
    fireEvent.click(screen.getByRole('button', { name: /complete connection/i }));

    await waitFor(() => {
      expect(screen.getByText(/Runtime restarted/i)).toBeInTheDocument();
    });
  });

  it('runs verification and runtime restart actions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return jsonResponse({
          connected: true,
          email: 'operator@example.com',
          runtimeHome: '/home/node',
          credentialFile: { exists: true },
          pendingSession: null,
          legacyRuntime: true,
          runtimeRole: 'legacy-fallback',
          provider: 'claude-agent-sdk',
        });
      }
      if (url.endsWith('/verify')) {
        return jsonResponse({
          ok: true,
          message: 'Legacy Claude fallback accepted a real query.',
          legacyRuntime: true,
          runtimeRole: 'legacy-fallback',
          provider: 'claude-agent-sdk',
        });
      }
      if (url.endsWith('/restart-runtime')) {
        return jsonResponse({ restarted: true });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ClaudeAuthPanel serverId="local" />);

    fireEvent.click(await screen.findByRole('button', { name: /verify/i }));
    expect(await screen.findByText(/accepted a real query/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /restart gateway runtime/i }));
    expect(await screen.findByText(/Runtime restarted/i)).toBeInTheDocument();
  });
});
