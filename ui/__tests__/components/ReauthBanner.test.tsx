import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReauthBanner } from '@/components/mcp/ReauthBanner';

describe('<ReauthBanner />', () => {
  it('renders server name and calls onReauth when button clicked', () => {
    const onReauth = vi.fn();
    render(<ReauthBanner serverName="postmypost" onReauth={onReauth} />);
    // Server name in the banner body.
    expect(screen.getByText(/Token for/)).toBeInTheDocument();
    expect(screen.getByText('postmypost')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /re-authorize/i }));
    expect(onReauth).toHaveBeenCalledTimes(1);
  });
});
