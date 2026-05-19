import { resolve } from 'node:path';
import type { Gateway } from '@backend/gateway.js';
import { getOverlayPath } from '@backend/config/overlay.js';

const CONFIG_PATH = resolve(process.cwd(), '..', 'config.yml');
const AGENTS_DIR = resolve(process.cwd(), '..', 'agents');
const DATA_DIR = resolve(process.cwd(), '..', 'data');
const OVERLAY_PATH = getOverlayPath(DATA_DIR);

interface GatewaySingletonState {
  instance: Gateway | null;
  initPromise: Promise<Gateway> | null;
  startedAt: Date | null;
}

const GLOBAL_GATEWAY_KEY = Symbol.for('anthroclaw.ui.gateway-singleton');

function getGatewayState(): GatewaySingletonState {
  const globalWithGateway = globalThis as typeof globalThis & {
    [GLOBAL_GATEWAY_KEY]?: GatewaySingletonState;
  };
  if (!globalWithGateway[GLOBAL_GATEWAY_KEY]) {
    globalWithGateway[GLOBAL_GATEWAY_KEY] = {
      instance: null,
      initPromise: null,
      startedAt: null,
    };
  }
  return globalWithGateway[GLOBAL_GATEWAY_KEY];
}

/**
 * Lazy singleton — initializes Gateway on first call.
 * If called concurrently while start() is in progress, waits for the existing promise.
 */
export async function getGateway(): Promise<Gateway> {
  const state = getGatewayState();
  if (state.instance) return state.instance;
  if (state.initPromise) return state.initPromise;

  state.initPromise = (async () => {
    const { Gateway: GatewayClass } = await import('@backend/gateway.js');
    const { loadGlobalConfigWithOverlay } = await import('@backend/config/overlay.js');

    const config = loadGlobalConfigWithOverlay(CONFIG_PATH, OVERLAY_PATH);
    const gw = new GatewayClass();
    await gw.start(config, AGENTS_DIR, DATA_DIR);

    state.instance = gw;
    state.startedAt = new Date();
    state.initPromise = null;
    return gw;
  })();

  return state.initPromise;
}

/**
 * Restart the gateway — stops the current instance and creates a new one.
 */
export async function restartGateway(): Promise<void> {
  const state = getGatewayState();
  if (state.instance) {
    await state.instance.stop();
    state.instance = null;
  }
  state.initPromise = null;
  state.startedAt = null;
  await getGateway();
}

/**
 * Returns the Date when the gateway was started, or null if not yet started.
 */
export function getStartedAt(): Date | null {
  return getGatewayState().startedAt;
}

// -- Test helpers ----------------------------------------------------------

/** @internal Reset singleton state (for testing) */
export function _resetForTest(): void {
  const state = getGatewayState();
  state.instance = null;
  state.initPromise = null;
  state.startedAt = null;
}

/** @internal Inject a mock gateway (for testing) */
export function _setInstanceForTest(gw: Gateway): void {
  const state = getGatewayState();
  state.instance = gw;
  state.startedAt = new Date();
}
