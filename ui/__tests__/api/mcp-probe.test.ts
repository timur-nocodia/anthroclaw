import { describe, expect, it, vi, beforeEach } from 'vitest';

const probeMock = vi.fn();

vi.mock('@backend/integrations/mcp-onboarding/probe.js', () => ({
  probe: (...args: unknown[]) => probeMock(...args),
}));

import { POST } from '@/app/api/mcp/probe/route';

describe('POST /api/mcp/probe', () => {
  beforeEach(() => {
    probeMock.mockReset();
  });

  it('returns probe result for valid url', async () => {
    probeMock.mockResolvedValueOnce({
      authMode: 'apikey',
      server: { name: 'x' },
    });
    const req = new Request('http://test/api/mcp/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://mcp.x.io/mcp' }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.authMode).toBe('apikey');
    expect(probeMock).toHaveBeenCalledWith('https://mcp.x.io/mcp');
  });

  it('returns 400 on missing url', async () => {
    const req = new Request('http://test/api/mcp/probe', {
      method: 'POST',
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_url');
  });

  it('returns 400 on non-URL string', async () => {
    const req = new Request('http://test/api/mcp/probe', {
      method: 'POST',
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new Request('http://test/api/mcp/probe', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('forwards manual classification to client', async () => {
    probeMock.mockResolvedValueOnce({
      authMode: 'manual',
      reason: 'non_bearer_scheme',
    });
    const req = new Request('http://test/api/mcp/probe', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://mcp.x.io/mcp' }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body).toEqual({
      authMode: 'manual',
      reason: 'non_bearer_scheme',
    });
  });
});
