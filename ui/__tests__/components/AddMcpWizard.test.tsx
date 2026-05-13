import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddMcpWizard } from '@/components/mcp/AddMcpWizard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AddMcpWizard — apikey path', () => {
  it('walks URL → auth → tools → save and calls onSaved', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url, body });
      if (url.endsWith('/api/mcp/probe')) {
        return new Response(
          JSON.stringify({ authMode: 'apikey', server: { name: 'x' } }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/mcp/connect/start')) {
        return new Response(
          JSON.stringify({
            status: 'awaiting_apikey',
            pendingId: 'pnd_1',
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/mcp/connect/apikey')) {
        return new Response(
          JSON.stringify({
            status: 'connected',
            tools: [{ name: 'post_create' }],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/mcp/connect/finalize')) {
        return new Response(JSON.stringify({ status: 'connected' }), {
          status: 200,
        });
      }
      throw new Error('unexpected ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <AddMcpWizard agentId="a1" onSaved={onSaved} onClose={onClose} />,
    );

    // Step 1: URL
    fireEvent.change(screen.getByPlaceholderText(/mcp\.x\.io/), {
      target: { value: 'https://mcp.test/mcp' },
    });
    fireEvent.click(screen.getByText(/Continue/));

    // Step 2: apikey
    await screen.findByText(/bearer token/i);
    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk_test' },
    });
    fireEvent.click(screen.getByText(/Continue/));

    // Step 3: tools — checkbox pre-selected
    await screen.findByText('post_create');
    fireEvent.click(screen.getByText(/Save & Connect/));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    // Ensure final POST body included allowed_tools.
    const finalizeCall = calls.find((c) =>
      c.url.endsWith('/api/mcp/connect/finalize'),
    );
    expect(finalizeCall?.body).toMatchObject({
      pendingId: 'pnd_1',
      allowed_tools: ['post_create'],
    });
  });

  it('surfaces finalize failure instead of silently closing on Save & Connect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/api/mcp/probe')) {
          return new Response(
            JSON.stringify({ authMode: 'apikey', server: { name: 'x' } }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/mcp/connect/start')) {
          return new Response(
            JSON.stringify({ status: 'awaiting_apikey', pendingId: 'pnd_x' }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/mcp/connect/apikey')) {
          return new Response(
            JSON.stringify({ status: 'connected', tools: [{ name: 'a' }] }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/mcp/connect/finalize')) {
          return new Response(
            JSON.stringify({ error: 'pending_expired' }),
            { status: 410 },
          );
        }
        throw new Error('unexpected ' + url);
      }),
    );

    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <AddMcpWizard agentId="a1" onSaved={onSaved} onClose={onClose} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/mcp\.x\.io/), {
      target: { value: 'https://mcp.test/mcp' },
    });
    fireEvent.click(screen.getByText(/Continue/));
    await screen.findByText(/bearer token/i);
    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk_test' },
    });
    fireEvent.click(screen.getByText(/Continue/));
    await screen.findByText('a');
    fireEvent.click(screen.getByText(/Save & Connect/));

    await waitFor(() => {
      expect(screen.getByText(/Couldn't save/i)).toBeInTheDocument();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows error and stays on URL step when probe returns manual', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/api/mcp/probe')) {
          return new Response(
            JSON.stringify({ authMode: 'manual', reason: 'non_bearer_scheme' }),
            { status: 200 },
          );
        }
        throw new Error('should not be called for ' + url);
      }),
    );

    render(
      <AddMcpWizard agentId="a1" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/mcp\.x\.io/), {
      target: { value: 'https://broken.example/mcp' },
    });
    fireEvent.click(screen.getByText(/Continue/));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(
      /unreachable|unsupported/i,
    );
    // Still on URL step.
    expect(screen.getByPlaceholderText(/mcp\.x\.io/)).toBeInTheDocument();
  });

  it('shows OAuth branch UI with hostname + scopes from probe metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/api/mcp/probe')) {
          return new Response(
            JSON.stringify({
              authMode: 'oauth',
              server: { name: 'NotionMCP' },
              oauth: {
                issuer: 'https://auth.notion.so/',
                authorizationEndpoint: 'https://auth.notion.so/oauth/authorize',
                tokenEndpoint: 'https://auth.notion.so/oauth/token',
                scopesSupported: ['read_content', 'write_content'],
                resource: 'https://mcp.notion.so/mcp',
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/mcp/connect/start')) {
          return new Response(
            JSON.stringify({
              status: 'authorize',
              pendingId: 'pnd_x',
              authUrl: 'https://ui.test/api/mcp/oauth/start/pnd_x',
              serverName: 'NotionMCP',
            }),
            { status: 200 },
          );
        }
        throw new Error('unexpected ' + url);
      }),
    );
    render(
      <AddMcpWizard agentId="a1" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/mcp\.x\.io/), {
      target: { value: 'https://mcp.notion.so/mcp' },
    });
    fireEvent.click(screen.getByText(/Continue/));
    await screen.findByText(/Authorize with NotionMCP/i);
    expect(screen.getByText(/auth\.notion\.so/)).toBeInTheDocument();
    expect(screen.getByText(/read_content, write_content/)).toBeInTheDocument();
  });

  it('Authorize button sets window.location to OAuth start URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/api/mcp/probe')) {
          return new Response(
            JSON.stringify({
              authMode: 'oauth',
              server: { name: 'X' },
              oauth: {
                issuer: 'https://auth/',
                authorizationEndpoint: 'https://auth/authorize',
                tokenEndpoint: 'https://auth/token',
                resource: 'https://mcp.x/mcp',
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/mcp/connect/start')) {
          return new Response(
            JSON.stringify({ status: 'authorize', pendingId: 'pnd_az' }),
            { status: 200 },
          );
        }
        throw new Error('unexpected ' + url);
      }),
    );

    const navigated: string[] = [];
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        set href(v: string) {
          navigated.push(v);
        },
      },
    });

    render(
      <AddMcpWizard agentId="a1" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/mcp\.x\.io/), {
      target: { value: 'https://mcp.x/mcp' },
    });
    fireEvent.click(screen.getByText(/Continue/));
    await screen.findByText(/Authorize with X/i);
    fireEvent.click(screen.getByText(/Continue/));
    await waitFor(() => expect(navigated).toContain('/api/mcp/oauth/start/pnd_az'));

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('skips the auth step for open servers (authMode=none) and lands directly in tool selection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/api/mcp/probe')) {
          return new Response(
            JSON.stringify({ authMode: 'none', server: { name: 'open' } }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/mcp/connect/start')) {
          return new Response(
            JSON.stringify({
              status: 'connected',
              pendingId: 'pnd_open',
              serverName: 'open',
              tools: [{ name: 'tool_one' }, { name: 'tool_two' }],
            }),
            { status: 200 },
          );
        }
        throw new Error('unexpected ' + url);
      }),
    );
    render(
      <AddMcpWizard agentId="a1" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/mcp\.x\.io/), {
      target: { value: 'https://open.example/mcp' },
    });
    fireEvent.click(screen.getByText(/Continue/));
    // Both discovered tools render directly — no API key prompt in between.
    await screen.findByText('tool_one');
    expect(screen.getByText('tool_two')).toBeInTheDocument();
    // Save button is the tools-step CTA, not the auth-step Continue.
    expect(screen.getByText(/Save & Connect/)).toBeInTheDocument();
  });

  it('shows friendly DCR-required error when reject reason is dcr_required_but_not_supported', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/api/mcp/probe')) {
          return new Response(
            JSON.stringify({
              authMode: 'oauth',
              server: { name: 'x' },
              oauth: {
                issuer: 'https://auth/',
                authorizationEndpoint: 'https://auth/authorize',
                tokenEndpoint: 'https://auth/token',
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/mcp/connect/start')) {
          return new Response(
            JSON.stringify({
              status: 'rejected',
              reason: 'dcr_required_but_not_supported',
            }),
            { status: 200 },
          );
        }
        throw new Error('unexpected ' + url);
      }),
    );
    render(
      <AddMcpWizard agentId="a1" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/mcp\.x\.io/), {
      target: { value: 'https://needs-dcr.example/mcp' },
    });
    fireEvent.click(screen.getByText(/Continue/));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(
      /dynamic client registration/i,
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /OAUTH_STATIC_CLIENT_ID/,
    );
  });

  it('falls back to generic message exposing the raw reason when unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/api/mcp/probe')) {
          return new Response(
            JSON.stringify({ authMode: 'apikey', server: { name: 'x' } }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/mcp/connect/start')) {
          return new Response(
            JSON.stringify({
              status: 'rejected',
              reason: 'some_brand_new_internal_code',
            }),
            { status: 200 },
          );
        }
        throw new Error('unexpected ' + url);
      }),
    );
    render(
      <AddMcpWizard agentId="a1" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/mcp\.x\.io/), {
      target: { value: 'https://x/mcp' },
    });
    fireEvent.click(screen.getByText(/Continue/));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(
      /Couldn't connect.*some_brand_new_internal_code/,
    );
  });

  it('Cancel button calls onClose without saving', () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <AddMcpWizard agentId="a1" onSaved={onSaved} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
