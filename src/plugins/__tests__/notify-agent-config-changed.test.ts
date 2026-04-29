/**
 * Unit tests for Gateway.notifyAgentConfigChanged — the lifecycle hook that
 * fires after a UI config write or enable/disable toggle so plugins caching
 * per-agent state (e.g. LCM's perAgent map) can invalidate.
 *
 * We exercise the method by constructing a Gateway, inserting fake
 * PluginEntry rows directly into its pluginRegistry, and asserting which
 * instance hooks fired (and that errors are caught).
 */

import { describe, it, expect, vi } from 'vitest';

import { Gateway } from '../../gateway.js';
import type { PluginInstance, PluginManifest } from '../types.js';

function makeManifest(name: string): PluginManifest {
  return { name, version: '0.1.0', entry: 'dist/index.js' };
}

describe('Gateway.notifyAgentConfigChanged', () => {
  it('invokes onAgentConfigChanged on plugins that implement it', async () => {
    const gw = new Gateway();
    const onChange = vi.fn();
    const inst: PluginInstance = { onAgentConfigChanged: onChange };
    gw.pluginRegistry.addPlugin('p1', { manifest: makeManifest('p1'), instance: inst });

    await gw.notifyAgentConfigChanged('agent-A');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('agent-A');
  });

  it('skips plugins without onAgentConfigChanged (no throw)', async () => {
    const gw = new Gateway();
    const onChange = vi.fn();
    gw.pluginRegistry.addPlugin('p-noop', { manifest: makeManifest('p-noop'), instance: {} });
    gw.pluginRegistry.addPlugin('p-listener', {
      manifest: makeManifest('p-listener'),
      instance: { onAgentConfigChanged: onChange },
    });

    await expect(gw.notifyAgentConfigChanged('agent-A')).resolves.toBeUndefined();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('catches a plugin throwing and still notifies the others', async () => {
    const gw = new Gateway();
    const second = vi.fn();
    gw.pluginRegistry.addPlugin('p-bad', {
      manifest: makeManifest('p-bad'),
      instance: {
        onAgentConfigChanged: () => {
          throw new Error('boom');
        },
      },
    });
    gw.pluginRegistry.addPlugin('p-good', {
      manifest: makeManifest('p-good'),
      instance: { onAgentConfigChanged: second },
    });

    // Method must not rethrow — a single misbehaving plugin cannot break
    // notification for siblings.
    await expect(gw.notifyAgentConfigChanged('agent-A')).resolves.toBeUndefined();
    expect(second).toHaveBeenCalledWith('agent-A');
  });

  it('awaits async onAgentConfigChanged before returning', async () => {
    const gw = new Gateway();
    const order: string[] = [];
    gw.pluginRegistry.addPlugin('p-async', {
      manifest: makeManifest('p-async'),
      instance: {
        async onAgentConfigChanged(agentId: string) {
          await new Promise((r) => setTimeout(r, 10));
          order.push(`done:${agentId}`);
        },
      },
    });

    await gw.notifyAgentConfigChanged('agent-A');
    order.push('after-notify');
    // The async plugin handler must have completed before notify resolves —
    // otherwise routes that await notifyAgentConfigChanged would race the
    // next dispatch.
    expect(order).toEqual(['done:agent-A', 'after-notify']);
  });

  it('is a no-op when no plugins are registered', async () => {
    const gw = new Gateway();
    await expect(gw.notifyAgentConfigChanged('agent-A')).resolves.toBeUndefined();
  });
});

describe('Gateway.getResolvedPluginsDir', () => {
  it('returns null before start() resolves the plugins dir', () => {
    const gw = new Gateway();
    expect(gw.getResolvedPluginsDir()).toBeNull();
  });
});
