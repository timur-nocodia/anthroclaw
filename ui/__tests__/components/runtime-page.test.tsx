import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RuntimePage from '@/app/(dashboard)/fleet/[serverId]/runtime/page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ serverId: 'local' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/settings/ClaudeAuthPanel', () => ({
  ClaudeAuthPanel: ({ serverId }: { serverId: string }) => (
    <div>Legacy fallback panel for {serverId}</div>
  ),
}));

describe('<RuntimePage />', () => {
  it('loads provider-neutral runtime control plane data', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/runtime/providers')) {
        return json({
          status: 'ok',
          runtimeMode: 'pi',
          defaultModel: 'anthropic/claude-sonnet-4-6',
          pi: {
            packageName: '@pi/agent-sdk',
            packageAvailable: true,
            packageVersion: '0.1.0',
            defaultModel: 'anthropic/claude-sonnet-4-6',
            authPath: '/tmp/pi-auth.json',
            authConfigured: true,
            modelsPath: '/tmp/pi-models.json',
            availableModelCount: 1,
            providers: [{
              id: 'anthropic',
              name: 'Anthropic',
              configured: true,
              modelCount: 1,
              defaultForInstance: true,
              supportsApiKey: true,
              authSource: 'storage',
              authLabel: 'configured',
            }],
            models: [{ id: 'anthropic/claude-sonnet-4-6', runtime: 'pi' }],
          },
          legacy: { visible: true, primary: false },
        });
      }
      if (url.endsWith('/runtime/gates')) {
        return json({
          status: 'ok',
          gates: [{
            id: 'controlled-live-turn',
            title: 'Controlled live turn',
            summary: 'Runs a guarded live turn plan.',
            capabilityGroup: 'messaging',
            focusedCommand: 'pnpm runtime:pi-live-gate',
            aggregateDispatcher: false,
            risk: 'high',
            action: 'live-turn',
            execution: {
              requiredFlags: ['agent', 'peer'],
              optionalFlags: ['dry-run'],
              supportsDryRun: true,
              safetyMode: 'operator-approved',
              approval: 'operator',
              exampleArgs: ['--agent', '<agent-id>'],
            },
          }],
        });
      }
      if (url.endsWith('/runtime/expansion-status')) {
        return json({
          status: 'attention',
          agentsDirs: ['/repo/agents'],
          packetsDir: '/repo/research/pi-expansion-packets',
          summary: {
            totalAgents: 1,
            highOrCriticalAgents: 1,
            closedAgents: 0,
            openAgents: 1,
            packetMissing: 0,
            blockedAgents: 0,
            closedEvidenceItems: 66,
            openEvidenceItems: 4,
            totalEvidenceItems: 70,
            evidenceProgressPercent: 94,
            openEvidenceByKind: {
              operatorApproval: 2,
              postExpansionMonitor: 2,
              liveAction: 0,
              automated: 0,
              manual: 0,
            },
          },
          agents: [{
            id: 'generic-agent',
            risk: 'high',
            recommendedRing: 'ring-2',
            agentsDir: '/repo/agents',
            state: 'pending_live_evidence',
            blockers: [],
            nextActions: ['collect operator approval'],
            packet: {
              present: true,
              path: '/repo/research/pi-expansion-packets/generic-agent.md',
              status: 'in_progress',
              checkedItems: 66,
              uncheckedItems: 4,
              totalItems: 70,
              uncheckedLabels: ['approval'],
              uncheckedByKind: {
                operatorApproval: 2,
                postExpansionMonitor: 2,
                liveAction: 0,
                automated: 0,
                manual: 0,
              },
            },
          }],
          gaps: {
            packetCoverageGap: false,
            missingPackets: [],
            auditErrors: [],
            skippedDirectories: [],
          },
          policy: {
            failOnOpen: false,
            allowExternalOpen: false,
            allowedOpenKinds: [],
            exitCode: 0,
            passed: true,
            reason: 'open evidence is allowed for dashboard visibility',
            disallowedOpenEvidenceByKind: {
              operatorApproval: 0,
              postExpansionMonitor: 0,
              liveAction: 0,
              automated: 0,
              manual: 0,
            },
            violations: [],
          },
        });
      }
      return json({ error: 'unexpected route' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RuntimePage />);

    await screen.findByText('Pi ready');

    expect(screen.getByTestId('runtime-page-shell')).toHaveClass('overflow-auto');
    expect(screen.getByTestId('runtime-page-content')).not.toHaveClass('overflow-auto');
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/local/runtime/providers');
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/local/runtime/gates');
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/local/runtime/expansion-status');
    expect(screen.getByText('Runtime setup')).toBeInTheDocument();
    expect(screen.getByText('Default model')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /advanced/i }));
    expect(screen.getByText('Side-effect gates')).toBeInTheDocument();
    expect(screen.getByText('controlled-live-turn')).toBeInTheDocument();
    expect(screen.getByText('Runs a guarded live turn plan.')).toBeInTheDocument();
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.getByText('Legacy fallback panel for local')).toBeInTheDocument();
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
