import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  McpServersSection,
  type ExternalMcpEntry,
} from '@/components/mcp/McpServersSection';

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
    // notion has 2 tools, linear has 1
    expect(screen.getByText(/http · 2 tools/)).toBeInTheDocument();
    expect(screen.getByText(/http · 1 tools/)).toBeInTheDocument();
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
});
