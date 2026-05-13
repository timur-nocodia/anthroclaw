import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  McpServersSection,
  type ExternalMcpEntry,
} from '@/components/mcp/McpServersSection';

/**
 * Default fetch stub for `/api/agents/.../mcp/.../status` calls fired by the
 * section's mount effect. Tests that want a non-default status override this
 * via `vi.stubGlobal('fetch', ...)`.
 */
function stubStatusFetch(
  resolver: (name: string) => unknown = () => ({ status: 'connected' }),
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      const m = url.match(/\/api\/agents\/[^/]+\/mcp\/([^/]+)\/status/);
      if (m) {
        return new Response(JSON.stringify(resolver(decodeURIComponent(m[1]))), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    }),
  );
}

beforeEach(() => {
  stubStatusFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<McpServersSection />', () => {
  it('renders empty-state copy when no servers configured', () => {
    render(
      <McpServersSection agentId="alice" servers={{}} onReload={vi.fn()} />,
    );
    expect(
      screen.getByText(/No external MCP servers\./i),
    ).toBeInTheDocument();
  });

  it('renders one McpServerCard per configured server', () => {
    const servers: Record<string, ExternalMcpEntry> = {
      notion: {
        type: 'http',
        url: 'https://mcp.notion.com',
        allowed_tools: ['search', 'fetch'],
        credential_ref: 'cred_notion',
      },
      linear: {
        type: 'http',
        url: 'https://mcp.linear.app/mcp',
        allowed_tools: ['list_issues'],
      },
    };
    render(
      <McpServersSection agentId="alice" servers={servers} onReload={vi.fn()} />,
    );
    // Both names appear in the card (display label) and again inside the
    // advanced details (raw-name heading). Use getAllByText.
    expect(screen.getAllByText('notion').length).toBeGreaterThan(0);
    expect(screen.getAllByText('linear').length).toBeGreaterThan(0);
    // notion has 2 tools, linear has 1 (card pluralises singular/plural)
    expect(screen.getByText(/http · 2 tools/)).toBeInTheDocument();
    expect(screen.getByText(/http · 1 tool$/)).toBeInTheDocument();
  });

  it('opens AddMcpWizard when "+ Add server" is clicked', () => {
    render(
      <McpServersSection agentId="alice" servers={{}} onReload={vi.fn()} />,
    );
    expect(
      screen.queryByRole('dialog', { name: /add mcp server/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add server/i }));
    expect(
      screen.getByRole('dialog', { name: /add mcp server/i }),
    ).toBeInTheDocument();
  });

  it('renders the advanced details when servers exist', () => {
    const servers: Record<string, ExternalMcpEntry> = {
      foo: { type: 'stdio', command: 'npx', args: ['foo'] },
    };
    render(
      <McpServersSection agentId="alice" servers={servers} onReload={vi.fn()} />,
    );
    expect(
      screen.getByText(/Advanced — manually edit raw fields/i),
    ).toBeInTheDocument();
  });

  it('fetches credential status per server on mount and shows reauth banner when API reports needs_reauth', async () => {
    stubStatusFetch((name) =>
      name === 'notion' ? { status: 'reauth_required' } : { status: 'connected' },
    );
    const servers: Record<string, ExternalMcpEntry> = {
      notion: {
        type: 'http',
        url: 'https://mcp.notion.com',
        credential_ref: 'mcp:notion',
      },
      linear: {
        type: 'http',
        url: 'https://mcp.linear.app/mcp',
        credential_ref: 'mcp:linear',
      },
    };
    render(
      <McpServersSection agentId="alice" servers={servers} onReload={vi.fn()} />,
    );
    // ReauthBanner renders "Token for <name> ..." copy
    await waitFor(() => {
      expect(screen.getByText(/Token for/)).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /re-authorize/i }),
    ).toBeInTheDocument();
    // The status endpoint should have been hit for both servers.
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const urls = calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/mcp/notion/status'))).toBe(true);
    expect(urls.some((u) => u.includes('/mcp/linear/status'))).toBe(true);
  });

  it('falls back to disabled when status fetch fails (defensive)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    const servers: Record<string, ExternalMcpEntry> = {
      foo: { type: 'http', url: 'https://mcp.foo/mcp' },
    };
    render(
      <McpServersSection agentId="alice" servers={servers} onReload={vi.fn()} />,
    );
    // No throw; card still renders with the fallback (no credential_ref → disabled).
    await waitFor(() => {
      expect(screen.getByText(/http · 0 tools/)).toBeInTheDocument();
    });
    // No ReauthBanner.
    expect(screen.queryByText(/Token for/)).not.toBeInTheDocument();
  });
});
