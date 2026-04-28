import 'dotenv/config';
import { resolve } from 'node:path';
import { getOverlayPath, loadGlobalConfigWithOverlay } from './config/overlay.js';
import { Gateway } from './gateway.js';
import { logger } from './logger.js';

const configPath = process.argv[2] ?? './config.yml';
const agentsDir = process.argv[3] ?? './agents';
const dataDir = process.argv[4] ?? './data';
const pluginsDir = process.argv[5] ?? './plugins';

async function main() {
  const config = loadGlobalConfigWithOverlay(
    resolve(configPath),
    getOverlayPath(resolve(dataDir)),
  );
  const gateway = new Gateway();

  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await gateway.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await gateway.stop();
    process.exit(0);
  });

  await gateway.start(config, resolve(agentsDir), resolve(dataDir), resolve(pluginsDir));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
