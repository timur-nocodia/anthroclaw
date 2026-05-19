import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RuntimeAuthPanel } from '@/components/settings/RuntimeAuthPanel';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('<RuntimeAuthPanel />', () => {
  it('renders Pi readiness from runtime status without exposing credential material', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      expect(String(input)).toContain('/api/fleet/local/runtime/status');
      return jsonResponse({
        harness: { id: 'runtime-v1' },
        defaultProvider: 'pi',
        pi: {
          packageName: '@earendil-works/pi-coding-agent',
          packageAvailable: true,
          defaultModel: 'anthropic/claude-sonnet-4-6',
          authPath: '/secure/pi-auth',
          authConfigured: true,
          modelsPath: '/secure/models.json',
          modelsConfigured: true,
        },
        agents: {
          total: 2,
          byEffectiveProvider: {
            pi: 2,
            'claude-agent-sdk': 0,
            opencode: 0,
          },
        },
        gateway: {
          activeSessions: 1,
        },
        legacy: {
          claudeAgentSdk: {
            present: false,
            primary: false,
          },
        },
      });
    }));

    render(<RuntimeAuthPanel serverId="local" />);

    expect(await screen.findByText('Pi ready')).toBeInTheDocument();
    expect(screen.getByText('Runtime v1 provider readiness')).toBeInTheDocument();
    expect(screen.getByText('@earendil-works/pi-coding-agent')).toBeInTheDocument();
    expect(screen.getByText('/secure/models.json')).toBeInTheDocument();
    expect(screen.queryByText(/Claude subscription auth/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/runtime-test-secret/i)).not.toBeInTheDocument();
  });

  it('shows legacy primary warning when the default provider is not Pi', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      harness: { id: 'runtime-v1' },
      defaultProvider: 'claude-agent-sdk',
      pi: {
        packageAvailable: true,
        authConfigured: false,
        modelsConfigured: false,
      },
      agents: {
        byEffectiveProvider: {
          pi: 0,
          'claude-agent-sdk': 1,
        },
      },
      legacy: {
        claudeAgentSdk: {
          present: true,
          primary: true,
        },
      },
    })));

    render(<RuntimeAuthPanel serverId="local" />);

    expect(await screen.findByText('Legacy primary')).toBeInTheDocument();
    expect(screen.getByText(/Default provider is still the legacy fallback/i)).toBeInTheDocument();
  });
});
