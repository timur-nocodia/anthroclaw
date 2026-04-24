import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createAccessControlTool } from '../../../src/agent/tools/access-control.js';
import { AccessControl } from '../../../src/routing/access.js';

describe('createAccessControlTool', () => {
  let tmpDir: string;

  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-tool-test-'));
    const ac = new AccessControl(tmpDir);
    const tool = createAccessControlTool('test-agent', ac);
    return { ac, tool };
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('has correct name', () => {
    const { tool } = setup();
    expect(tool.name).toBe('access_control');
  });

  it('list_pending returns empty when none', async () => {
    const { tool } = setup();
    const res = await tool.handler({ action: 'list_pending' });
    expect(res.content[0].text).toContain('No pending');
  });

  it('list_approved returns empty when none', async () => {
    const { tool } = setup();
    const res = await tool.handler({ action: 'list_approved' });
    expect(res.content[0].text).toContain('No approved');
  });

  it('list_pending shows pending users', async () => {
    const { ac, tool } = setup();
    ac.check('test-agent', 'user-1', 'telegram', {
      pairing: { mode: 'approve', approver_chat_id: 'admin' },
    });
    const res = await tool.handler({ action: 'list_pending' });
    expect(res.content[0].text).toContain('user-1');
  });

  it('approve moves user from pending to approved', async () => {
    const { ac, tool } = setup();
    ac.check('test-agent', 'user-1', 'telegram', {
      pairing: { mode: 'approve', approver_chat_id: 'admin' },
    });

    const res = await tool.handler({ action: 'approve', sender_id: 'user-1' });
    expect(res.content[0].text).toContain('Approved: user-1');

    const check = ac.check('test-agent', 'user-1', 'telegram', {
      pairing: { mode: 'approve', approver_chat_id: 'admin' },
    });
    expect(check.allowed).toBe(true);
  });

  it('approve force-approves user not in pending', async () => {
    const { tool } = setup();
    const res = await tool.handler({ action: 'approve', sender_id: 'user-99' });
    expect(res.content[0].text).toContain('Force-approved');
  });

  it('approve requires sender_id', async () => {
    const { tool } = setup();
    const res = await tool.handler({ action: 'approve' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('sender_id is required');
  });

  it('revoke removes approved user', async () => {
    const { ac, tool } = setup();
    ac.check('test-agent', 'user-1', 'telegram', {
      pairing: { mode: 'open' },
    });

    const res = await tool.handler({ action: 'revoke', sender_id: 'user-1' });
    expect(res.content[0].text).toContain('Revoked: user-1');

    const approved = ac.listApproved('test-agent');
    expect(approved).not.toContain('user-1');
  });

  it('revoke returns message when user not found', async () => {
    const { tool } = setup();
    const res = await tool.handler({ action: 'revoke', sender_id: 'ghost' });
    expect(res.content[0].text).toContain('was not in approved list');
  });

  it('revoke requires sender_id', async () => {
    const { tool } = setup();
    const res = await tool.handler({ action: 'revoke' });
    expect(res.isError).toBe(true);
  });

  it('list_approved shows approved users after open-mode check', async () => {
    const { ac, tool } = setup();
    ac.check('test-agent', 'user-x', 'telegram', {
      pairing: { mode: 'open' },
    });
    const res = await tool.handler({ action: 'list_approved' });
    expect(res.content[0].text).toContain('user-x');
  });
});
