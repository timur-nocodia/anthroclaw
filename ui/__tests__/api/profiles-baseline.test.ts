import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ email: 'admin@test.com', authMethod: 'cookie' }),
  handleAuthError: vi.fn(),
}));

describe('GET /api/security/profiles/[name]/baseline', () => {
  it('returns baseline for chat_like_openclaw', async () => {
    const { GET } = await import('@/app/api/security/profiles/[name]/baseline/route');
    const req = new NextRequest('http://localhost:3000/api/security/profiles/chat_like_openclaw/baseline');
    const res = await GET(req, { params: Promise.resolve({ name: 'chat_like_openclaw' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.baseline).toBe('string');
    expect(json.baseline.length).toBeGreaterThan(50);
    expect(json.baseline.toLowerCase()).toContain('messaging');
  });

  it('returns 404 for unknown profile', async () => {
    const { GET } = await import('@/app/api/security/profiles/[name]/baseline/route');
    const req = new NextRequest('http://localhost:3000/api/security/profiles/nonexistent/baseline');
    const res = await GET(req, { params: Promise.resolve({ name: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-chat profiles (no baseline concept)', async () => {
    const { GET } = await import('@/app/api/security/profiles/[name]/baseline/route');
    const req = new NextRequest('http://localhost:3000/api/security/profiles/public/baseline');
    const res = await GET(req, { params: Promise.resolve({ name: 'public' }) });
    expect(res.status).toBe(404);
  });
});
