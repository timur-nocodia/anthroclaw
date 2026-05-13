import { describe, expect, it } from 'vitest';
import {
  createDefaultBuildroomConfig,
  validateBuildroomConfig,
} from '../model.js';

describe('Auto-Buildroom config model', () => {
  it('creates a safe manual-approval default config', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'cli:user:local-operator',
    });

    expect(config.schemaVersion).toBe('auto-buildroom/v1');
    expect(config.roomId).toBe('anthroclaw-core');
    expect(config.mode).toBe('manual_approval');
    expect(config.killSwitchActive).toBe(false);
    expect(config.watch.sessions.enabled).toBe(false);
    expect(config.watch.rawTranscripts.enabled).toBe(false);
    expect(config.external.sideEffects.default).toBe('deny');
    expect(config.execution.requireApprovalForBuild).toBe(true);
    expect(config.execution.consumeApprovalOnBuildStart).toBe(true);
    expect(config.budgets.maxBuildsPerDay).toBe(1);
    expect(config.notifications.routes).toEqual([]);
  });

  it('rejects manual-approval config without an operator identity', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'cli:user:local-operator',
    });
    config.operators = [];

    const result = validateBuildroomConfig(config);

    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain(
      'manual_approval requires at least one operator',
    );
  });

  it('rejects Telegram chat or thread routes as operator identity', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_chat:-1001234567890',
    });

    const result = validateBuildroomConfig(config);

    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain(
      'Telegram chat/thread route is not operator identity',
    );
  });

  it('rejects Telegram user identities in route fields', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'telegram_user:123456789',
    });
    config.operators[0].commandRoutes = ['telegram_user:123456789'];
    config.operators[0].approvalRoutes = ['telegram_user:123456789'];
    config.notifications.routes = ['telegram_user:123456789'];

    const result = validateBuildroomConfig(config);

    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toContain(
      'Telegram user identity is not a route',
    );
  });

  it('rejects allowed and blocked path patterns that escape the repository root', () => {
    const config = createDefaultBuildroomConfig({
      roomId: 'anthroclaw-core',
      operatorId: 'cli:user:local-operator',
    });
    config.paths.allowed = ['../outside/**'];
    config.paths.blocked = ['/etc/passwd'];

    const result = validateBuildroomConfig(config);

    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toContain(
      'path pattern must stay inside repository root',
    );
  });
});
