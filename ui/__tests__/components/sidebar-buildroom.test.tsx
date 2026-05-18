import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from '@/components/sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/fleet/local/buildroom',
  useParams: () => ({ serverId: 'local' }),
}));

describe('<Sidebar /> Buildroom navigation', () => {
  it('links to the local Buildroom cockpit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).includes('/api/fleet/servers/local')) {
        return new Response(JSON.stringify({ name: 'local', environment: 'development' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ summary: { healthy: 1, gateways: 1 }, servers: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    render(<Sidebar />);

    const link = await screen.findByRole('link', { name: /buildroom/i });
    expect(link).toHaveAttribute('href', '/fleet/local/buildroom');
    expect(link).toHaveStyle({ color: 'var(--oc-accent)' });

    expect(screen.getByRole('link', { name: /runtime/i })).toHaveAttribute('href', '/fleet/local/runtime');
  });
});
