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

  it('shows OAuth branch UI when authMode is oauth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/api/mcp/probe')) {
          return new Response(
            JSON.stringify({ authMode: 'oauth', server: {} }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/mcp/connect/start')) {
          return new Response(
            JSON.stringify({ status: 'authorize', pendingId: 'pnd_x' }),
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
      target: { value: 'https://o.example/mcp' },
    });
    fireEvent.click(screen.getByText(/Continue/));
    await screen.findByText(/uses OAuth/i);
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
