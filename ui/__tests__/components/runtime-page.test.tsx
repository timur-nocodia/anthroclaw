import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RuntimePage from '@/app/(dashboard)/fleet/[serverId]/runtime/page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ serverId: 'local' }),
}));

vi.mock('@/components/settings/ClaudeAuthPanel', () => ({
  ClaudeAuthPanel: ({ serverId }: { serverId: string }) => (
    <div>Legacy Claude compatibility panel for {serverId}</div>
  ),
}));

describe('<RuntimePage />', () => {
  it('loads provider-neutral runtime control plane data', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/runtime/status')) {
        return json({
          harness: { id: 'runtime-v1' },
          defaultProvider: 'pi',
          pi: {
            packageName: '@pi/agent-sdk',
            packageAvailable: true,
            defaultModel: 'anthropic/claude-sonnet-4-6',
            authPath: '/tmp/pi-auth.json',
            authConfigured: true,
            modelsPath: '/tmp/pi-models.json',
            modelsConfigured: true,
          },
          agents: {
            total: 2,
            byEffectiveProvider: {
              pi: 2,
              'claude-agent-sdk': 0,
              opencode: 0,
            },
          },
          gateway: { activeSessions: 1 },
          legacy: { claudeAgentSdk: { present: true, primary: false } },
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
      if (url.endsWith('/runtime/models')) {
        return json({
          defaultProvider: 'pi',
          defaultModel: 'anthropic/claude-sonnet-4-6',
          groups: [{
            id: 'pi',
            title: 'Pi configured models',
            enabled: true,
            source: { kind: 'configured' },
            models: [{ id: 'anthropic/claude-sonnet-4-6', runtime: 'pi' }],
          }],
          options: [{ id: 'anthropic/claude-sonnet-4-6', runtime: 'pi' }],
        });
      }
      return json({ error: 'unexpected route' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RuntimePage />);

    await screen.findByText('pi ready');

    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/local/runtime/status');
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/local/runtime/gates');
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/local/runtime/expansion-status');
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/local/runtime/models');
    expect(screen.getByText('runtime-v1')).toBeInTheDocument();
    expect(screen.getByText('Pi configured models')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /gates/i }));
    expect(screen.getAllByText('Controlled live turn').length).toBeGreaterThan(0);
    expect(screen.getByText('This UI view is plan-only. Live gate execution stays disabled until a separate approval flow is implemented.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /expansion/i }));
    expect(screen.getByText('94%')).toBeInTheDocument();
    expect(screen.getByText('generic-agent')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /legacy/i }));
    expect(screen.getByText('Legacy Claude compatibility panel for local')).toBeInTheDocument();
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
