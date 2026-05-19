import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentYml } from '../../src/config/loader.js';
import { RouteTable } from '../../src/routing/table.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const agentsDir = resolve(repoRoot, 'agents');

describe('tracked example agent routing', () => {
  it('routes generic default Telegram DMs to the public example agent', () => {
    const table = RouteTable.build([
      {
        id: 'example',
        config: loadAgentYml(resolve(agentsDir, 'example')),
      },
    ]);

    expect(table.resolve('telegram', 'default', 'dm', 'peer-1')?.agentId).toBe('example');
  });
});
