import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { McpServerCard, type McpServerCardProps } from '@/components/mcp/McpServerCard';

function makeProps(
  overrides: Partial<McpServerCardProps> = {},
): McpServerCardProps {
  return {
    name: 'notion',
    url: 'https://mcp.notion.com',
    transport: 'http',
    toolCount: 3,
    status: 'connected',
    onEditAllowed: vi.fn(),
    onReauth: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
}

describe('<McpServerCard />', () => {
  it('does NOT show ReauthBanner when status is connected', () => {
    render(<McpServerCard {...makeProps({ status: 'connected' })} />);
    expect(screen.queryByText(/Token for/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /re-authorize/i }),
    ).not.toBeInTheDocument();
  });

  it('shows ReauthBanner only when status=reauth_required', () => {
    const { rerender } = render(
      <McpServerCard {...makeProps({ status: 'connected' })} />,
    );
    expect(screen.queryByText(/Token for/)).not.toBeInTheDocument();
    rerender(<McpServerCard {...makeProps({ status: 'reauth_required' })} />);
    expect(screen.getByText(/Token for/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /re-authorize/i }),
    ).toBeInTheDocument();
  });

  it('renders the status dot color matching each status', () => {
    const { rerender } = render(
      <McpServerCard {...makeProps({ status: 'connected' })} />,
    );
    expect(
      screen.getByTestId('mcp-server-card-status-dot').className,
    ).toContain('bg-green-500');

    rerender(<McpServerCard {...makeProps({ status: 'refreshing' })} />);
    expect(
      screen.getByTestId('mcp-server-card-status-dot').className,
    ).toContain('bg-yellow-500');

    rerender(<McpServerCard {...makeProps({ status: 'reauth_required' })} />);
    expect(
      screen.getByTestId('mcp-server-card-status-dot').className,
    ).toContain('bg-orange-500');

    rerender(<McpServerCard {...makeProps({ status: 'disabled' })} />);
    expect(
      screen.getByTestId('mcp-server-card-status-dot').className,
    ).toContain('bg-zinc-400');
  });

  it('renders transport label and tool count', () => {
    render(<McpServerCard {...makeProps({ transport: 'sse', toolCount: 7 })} />);
    expect(screen.getByText(/sse · 7 tools/)).toBeInTheDocument();
  });

  it('shows expiry timestamp in the status dot title when provided', () => {
    const expiresAt = new Date('2030-01-02T03:04:05Z').getTime();
    render(<McpServerCard {...makeProps({ tokenExpiresAt: expiresAt })} />);
    const dot = screen.getByTestId('mcp-server-card-status-dot');
    expect(dot.getAttribute('title')).toContain('Connected · expires');
  });

  it('invokes onEditAllowed when "Edit allowed tools" clicked', () => {
    const onEditAllowed = vi.fn();
    render(<McpServerCard {...makeProps({ onEditAllowed })} />);
    fireEvent.click(screen.getByRole('button', { name: /edit allowed tools/i }));
    expect(onEditAllowed).toHaveBeenCalledTimes(1);
  });

  it('invokes onReauth from the card-level Re-auth button', () => {
    const onReauth = vi.fn();
    render(<McpServerCard {...makeProps({ onReauth })} />);
    // There is exactly one Re-auth button when status !== 'reauth_required'.
    fireEvent.click(screen.getByRole('button', { name: /^re-auth$/i }));
    expect(onReauth).toHaveBeenCalledTimes(1);
  });

  it('invokes onReauth from the banner button when status=reauth_required', () => {
    const onReauth = vi.fn();
    render(
      <McpServerCard
        {...makeProps({ onReauth, status: 'reauth_required' })}
      />,
    );
    // Both the banner's "Re-authorize" and the card's "Re-auth" wire to the
    // same handler. Click only the banner button here.
    fireEvent.click(screen.getByRole('button', { name: /re-authorize/i }));
    expect(onReauth).toHaveBeenCalledTimes(1);
  });

  it('invokes onRemove when Remove clicked', () => {
    const onRemove = vi.fn();
    render(<McpServerCard {...makeProps({ onRemove })} />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
