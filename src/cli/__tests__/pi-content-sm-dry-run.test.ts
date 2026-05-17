import { describe, expect, it } from 'vitest';
import {
  parsePiContentSmDryRunArgs,
  runPiContentSmDryRunCli,
} from '../pi-content-sm-dry-run.js';

describe('Pi content_sm_building dry-run CLI', () => {
  it('runs fanout and schedule tools against fake side-effect targets', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiContentSmDryRunCli(['--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.content-sm-safe-dry-run',
      agentId: 'content_sm_building',
      assertions: {
        chatLikePolicyAllowsSendMessage: true,
        chatLikePolicyAllowsSendMedia: true,
        chatLikePolicyAllowsManageCron: true,
        fakeChannelOnly: true,
        noRealTelegramDelivery: true,
        sendMessageFakeSends: 1,
        sendMediaFakeSends: 1,
        sendMessagePeerId: '-100content-sm-canary',
        sendMediaPeerId: '-100content-sm-canary',
        sendMessageThreadId: '42',
        sendMediaThreadId: '42',
        sendMessageAccountId: 'content_sm',
        sendMediaAccountId: 'content_sm',
        tempCronJobsCreated: 1,
        tempCronJobsRemaining: 0,
        tempCronIgnoredModelSuppliedDeliverTo: true,
      },
    });
    expect(body.assertions.tempCronDeliverTo).toMatchObject({
      channel: 'telegram',
      peer_id: '-100content-sm-canary',
      account_id: 'content_sm',
      thread_id: '42',
    });
    expect(body.workspacePath).toBeUndefined();
  });

  it('parses flags narrowly', () => {
    expect(parsePiContentSmDryRunArgs([
      '--',
      '--json',
      '--keep-workspace',
    ])).toMatchObject({
      json: true,
      keepWorkspace: true,
    });
    expect(() => parsePiContentSmDryRunArgs(['--wat'])).toThrow(/Unknown argument/);
  });
});

function createWriter() {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}
