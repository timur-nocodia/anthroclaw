export const SIDE_EFFECT_GATE_REGISTRY = [
  {
    id: 'live-send-message',
    focusedCommand: 'runtime:pi-live-send-message-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-live-send-message',
    aggregateDispatcher: true,
    risk: 'external_write',
    action: 'message.send',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id'],
      optionalFlags: ['account-id', 'marker', 'dry-run', 'confirm-live-send', 'json'],
      supportsDryRun: true,
      safetyMode: 'dry-run-first',
      approval: 'required-for-live',
      exampleArgs: ['--agent-id', '<id>', '--peer-id', '<peer>', '--dry-run', '--json'],
    }),
  },
  {
    id: 'live-send-media',
    focusedCommand: 'runtime:pi-live-send-media-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-live-send-media',
    aggregateDispatcher: true,
    risk: 'external_write',
    action: 'message.send_media',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id', 'file-path', 'allowed-file-root'],
      optionalFlags: ['account-id', 'caption', 'marker', 'dry-run', 'confirm-live-send', 'json'],
      supportsDryRun: true,
      safetyMode: 'dry-run-first',
      approval: 'required-for-live',
      exampleArgs: [
        '--agent-id', '<id>',
        '--peer-id', '<peer>',
        '--file-path', '<path>',
        '--allowed-file-root', '<root>',
        '--dry-run',
        '--json',
      ],
    }),
  },
  {
    id: 'live-notification',
    focusedCommand: 'runtime:pi-live-notification-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-live-notification',
    aggregateDispatcher: true,
    risk: 'external_write',
    action: 'notification.emit',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id'],
      optionalFlags: ['account-id', 'marker', 'dry-run', 'confirm-live-send', 'json'],
      supportsDryRun: true,
      safetyMode: 'dry-run-first',
      approval: 'required-for-live',
      exampleArgs: ['--agent-id', '<id>', '--peer-id', '<peer>', '--dry-run', '--json'],
    }),
  },
  {
    id: 'cron-notification',
    focusedCommand: 'runtime:pi-cron-notification-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-cron-notification-smoke',
    aggregateDispatcher: true,
    risk: 'scheduled_external_write',
    action: 'cron.notification',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id', 'sender-id', 'static-cron-id', 'dynamic-cron-id'],
      optionalFlags: ['account-id', 'notification-marker', 'json'],
      supportsDryRun: false,
      safetyMode: 'temp-only',
      approval: 'operator-review',
      exampleArgs: [
        '--agent-id', '<id>',
        '--peer-id', '<peer>',
        '--sender-id', '<sender>',
        '--static-cron-id', '<id>',
        '--dynamic-cron-id', '<id>',
        '--json',
      ],
    }),
  },
  {
    id: 'buildroom-handoff',
    focusedCommand: 'runtime:pi-buildroom-handoff-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-buildroom-handoff-smoke',
    aggregateDispatcher: true,
    risk: 'workspace_write',
    action: 'buildroom.handoff',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id', 'sender-id'],
      optionalFlags: ['account-id', 'json'],
      supportsDryRun: false,
      safetyMode: 'temp-only',
      approval: 'operator-review',
      exampleArgs: ['--agent-id', '<id>', '--peer-id', '<peer>', '--sender-id', '<sender>', '--json'],
    }),
  },
  {
    id: 'admin-config',
    focusedCommand: 'runtime:pi-admin-config-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-admin-config-smoke',
    aggregateDispatcher: true,
    risk: 'config_write',
    action: 'admin.config',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id', 'session-key'],
      optionalFlags: ['account-id', 'json'],
      supportsDryRun: false,
      safetyMode: 'temp-only',
      approval: 'operator-review',
      exampleArgs: ['--agent-id', '<id>', '--peer-id', '<peer>', '--session-key', '<key>', '--json'],
    }),
  },
  {
    id: 'mcp-file-transfer',
    focusedCommand: 'runtime:pi-mcp-file-transfer-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-mcp-file-transfer-smoke',
    aggregateDispatcher: true,
    risk: 'filesystem_write',
    action: 'mcp.file_transfer',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id', 'sender-id'],
      optionalFlags: ['account-id', 'expect-root', 'json'],
      supportsDryRun: false,
      safetyMode: 'temp-only',
      approval: 'operator-review',
      exampleArgs: ['--agent-id', '<id>', '--peer-id', '<peer>', '--sender-id', '<sender>', '--json'],
    }),
  },
  {
    id: 'honcho-local',
    focusedCommand: 'runtime:pi-honcho-local-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-honcho-local-smoke',
    aggregateDispatcher: true,
    risk: 'local_service',
    action: 'honcho.memory',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id', 'expected-workspace-id'],
      optionalFlags: ['account-id', 'json'],
      supportsDryRun: false,
      safetyMode: 'temp-only',
      approval: 'operator-review',
      exampleArgs: ['--agent-id', '<id>', '--peer-id', '<peer>', '--expected-workspace-id', '<workspace>', '--json'],
    }),
  },
  {
    id: 'learning-propose',
    focusedCommand: 'runtime:pi-learning-propose-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-learning-propose-smoke',
    aggregateDispatcher: true,
    risk: 'learning_proposal',
    action: 'learning.propose',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id', 'sender-id'],
      optionalFlags: ['account-id', 'run-id', 'allow-skip', 'json'],
      supportsDryRun: false,
      safetyMode: 'propose-only',
      approval: 'operator-review',
      exampleArgs: ['--agent-id', '<id>', '--peer-id', '<peer>', '--sender-id', '<sender>', '--json', '--allow-skip'],
    }),
  },
  {
    id: 'memory-read',
    focusedCommand: 'runtime:pi-memory-read-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-memory-read-smoke',
    aggregateDispatcher: true,
    risk: 'read_only',
    action: 'memory.read',
    execution: executionHints({
      requiredFlags: ['agent-id', 'peer-id', 'sender-id'],
      optionalFlags: ['account-id', 'allow-skip', 'json'],
      supportsDryRun: false,
      safetyMode: 'read-only',
      approval: 'not-required-read-only',
      exampleArgs: ['--agent-id', '<id>', '--peer-id', '<peer>', '--sender-id', '<sender>', '--json', '--allow-skip'],
    }),
  },
] as const;

export type SideEffectGateRegistryEntry = typeof SIDE_EFFECT_GATE_REGISTRY[number];
export type SideEffectGateId = SideEffectGateRegistryEntry['id'];

export function sideEffectGateIds(): SideEffectGateId[] {
  return SIDE_EFFECT_GATE_REGISTRY.map((gate) => gate.id);
}

export function findSideEffectGate(id: string): SideEffectGateRegistryEntry | undefined {
  return SIDE_EFFECT_GATE_REGISTRY.find((gate) => gate.id === id);
}

type SideEffectGateSafetyMode = 'dry-run-first' | 'temp-only' | 'propose-only' | 'read-only';
type SideEffectGateApprovalMode = 'required-for-live' | 'operator-review' | 'not-required-read-only';

interface SideEffectGateExecutionHints {
  requiredFlags: string[];
  optionalFlags: string[];
  supportsDryRun: boolean;
  safetyMode: SideEffectGateSafetyMode;
  approval: SideEffectGateApprovalMode;
  exampleArgs: string[];
}

function executionHints(hints: SideEffectGateExecutionHints): SideEffectGateExecutionHints {
  return hints;
}
