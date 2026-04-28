import { resolve } from 'node:path';
import type { Gateway } from '@backend/gateway.js';
import { getOverlayPath } from '@backend/config/overlay.js';

const CONFIG_PATH = resolve(process.cwd(), '..', 'config.yml');
const AGENTS_DIR = resolve(process.cwd(), '..', 'agents');
const DATA_DIR = resolve(process.cwd(), '..', 'data');
const OVERLAY_PATH = getOverlayPath(DATA_DIR);

let instance: Gateway | null = null;
let initPromise: Promise<Gateway> | null = null;
let startedAt: Date | null = null;

/**
 * Lazy singleton — initializes Gateway on first call.
 * If called concurrently while start() is in progress, waits for the existing promise.
 */
export async function getGateway(): Promise<Gateway> {
  if (instance) return instance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { Gateway: GatewayClass } = await import('@backend/gateway.js');
    const { loadGlobalConfigWithOverlay } = await import('@backend/config/overlay.js');

    const config = loadGlobalConfigWithOverlay(CONFIG_PATH, OVERLAY_PATH);
    const gw = new GatewayClass();
    await gw.start(config, AGENTS_DIR, DATA_DIR);

    instance = gw;
    startedAt = new Date();
    initPromise = null;
    return gw;
  })();

  return initPromise;
}

/**
 * Restart the gateway — stops the current instance and creates a new one.
 */
export async function restartGateway(): Promise<void> {
  if (instance) {
    await instance.stop();
    instance = null;
  }
  initPromise = null;
  startedAt = null;
  await getGateway();
}

/**
 * Returns the Date when the gateway was started, or null if not yet started.
 */
export function getStartedAt(): Date | null {
  return startedAt;
}

// -- Test helpers ----------------------------------------------------------

/** @internal Reset singleton state (for testing) */
export function _resetForTest(): void {
  instance = null;
  initPromise = null;
  startedAt = null;
}

/** @internal Inject a mock gateway (for testing) */
export function _setInstanceForTest(gw: Gateway): void {
  instance = gw;
  startedAt = new Date();
}
