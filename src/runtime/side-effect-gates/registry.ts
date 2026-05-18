export const SIDE_EFFECT_GATE_REGISTRY = [
  {
    id: 'live-send-message',
    focusedCommand: 'runtime:pi-live-send-message-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-live-send-message',
    aggregateDispatcher: true,
    risk: 'external_write',
    action: 'message.send',
  },
  {
    id: 'live-send-media',
    focusedCommand: 'runtime:pi-live-send-media-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-live-send-media',
    aggregateDispatcher: true,
    risk: 'external_write',
    action: 'message.send_media',
  },
  {
    id: 'live-notification',
    focusedCommand: 'runtime:pi-live-notification-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-live-notification',
    aggregateDispatcher: true,
    risk: 'external_write',
    action: 'notification.emit',
  },
  {
    id: 'cron-notification',
    focusedCommand: 'runtime:pi-cron-notification-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-cron-notification-smoke',
    aggregateDispatcher: true,
    risk: 'scheduled_external_write',
    action: 'cron.notification',
  },
  {
    id: 'buildroom-handoff',
    focusedCommand: 'runtime:pi-buildroom-handoff-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-buildroom-handoff-smoke',
    aggregateDispatcher: true,
    risk: 'workspace_write',
    action: 'buildroom.handoff',
  },
  {
    id: 'admin-config',
    focusedCommand: 'runtime:pi-admin-config-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-admin-config-smoke',
    aggregateDispatcher: true,
    risk: 'config_write',
    action: 'admin.config',
  },
  {
    id: 'mcp-file-transfer',
    focusedCommand: 'runtime:pi-mcp-file-transfer-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-mcp-file-transfer-smoke',
    aggregateDispatcher: true,
    risk: 'filesystem_write',
    action: 'mcp.file_transfer',
  },
  {
    id: 'honcho-local',
    focusedCommand: 'runtime:pi-honcho-local-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-honcho-local-smoke',
    aggregateDispatcher: true,
    risk: 'local_service',
    action: 'honcho.memory',
  },
  {
    id: 'learning-propose',
    focusedCommand: 'runtime:pi-learning-propose-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-learning-propose-smoke',
    aggregateDispatcher: true,
    risk: 'learning_proposal',
    action: 'learning.propose',
  },
  {
    id: 'memory-read',
    focusedCommand: 'runtime:pi-memory-read-gate',
    compatibilityCommand: 'runtime:pi-timur-agent-memory-read-smoke',
    aggregateDispatcher: true,
    risk: 'read_only',
    action: 'memory.read',
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
