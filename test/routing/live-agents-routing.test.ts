import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentYml } from '../../src/config/loader.js';
import { RouteTable } from '../../src/routing/table.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const agentsDir = resolve(repoRoot, 'agents');

describe('tracked agent routing', () => {
  it('routes the connected default Telegram bot to timur_agent while keeping pi_telegram_lab archived', () => {
    const table = RouteTable.build([
      {
        id: 'example',
        config: loadAgentYml(resolve(agentsDir, 'example')),
      },
      {
        id: 'pi_telegram_lab',
        config: loadAgentYml(resolve(agentsDir, 'pi_telegram_lab')),
      },
      {
        id: 'timur_agent',
        config: loadAgentYml(resolve(agentsDir, 'timur_agent')),
      },
    ]);

    expect(table.resolve('telegram', 'default', 'dm', '48705953')?.agentId).toBe('timur_agent');
    expect(table.resolve('telegram', 'default', 'dm', 'not-the-lab-peer')?.agentId).toBe(
      'example',
    );
    expect(table.resolve('telegram', 'pi_telegram_lab_archive', 'dm', '48705953')?.agentId).toBe(
      'pi_telegram_lab',
    );
  });
});
