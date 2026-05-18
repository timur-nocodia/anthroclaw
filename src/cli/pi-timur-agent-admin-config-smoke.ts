import 'dotenv/config';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAccessControlTool } from '../agent/tools/access-control.js';
import { createManageHumanTakeoverTool } from '../agent/tools/manage-human-takeover.js';
import { createManageOperatorConsoleTool } from '../agent/tools/manage-operator-console.js';
import { createShowConfigTool } from '../agent/tools/show-config.js';
import { createConfigAuditLog } from '../config/audit.js';
import { loadAgentYml } from '../config/loader.js';
import { createAgentConfigWriter } from '../config/writer.js';
import { AccessControl } from '../routing/access.js';

const AGENT_ID = 'timur_agent';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_SESSION_KEY = `${AGENT_ID}:telegram:dm:${DEFAULT_PEER_ID}`;
const PENDING_SENDER_ID = 'timur-agent-admin-config-pending';
const UNAUTHORIZED_TARGET_ID = 'unauthorized_agent';

interface PiTimurAgentAdminConfigSmokeArgs {
  agentsDir: string;
  peerId: string;
  sessionKey: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentAdminConfigSmokeDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiTimurAgentAdminConfigSmokeResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  dataDir: string;
  peerId: string;
  permissions: {
    adminToolsPresent: boolean;
    privateAllowlistSinglePeer: boolean;
    selfManageAllowed: boolean;
    crossAgentDenied: boolean;
  };
  config: {
    showConfigRead: boolean;
    operatorConsolePatched: boolean;
    humanTakeoverPatched: boolean;
    auditEntries: number;
    lastModifiedSeen: boolean;
    backupsCreated: number;
    tempOnly: boolean;
  };
  accessControl: {
    pendingListed: boolean;
    approved: boolean;
    approvedListed: boolean;
    revoked: boolean;
    approvedAfterRevoke: number;
    tempOnly: boolean;
  };
  error?: string;
}

export async function runPiTimurAgentAdminConfigSmokeCli(
  argv: string[],
  deps: PiTimurAgentAdminConfigSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentAdminConfigSmokeArgs;

  try {
    args = parsePiTimurAgentAdminConfigSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-admin-config-'));
  try {
    const result = await runPiTimurAgentAdminConfigSmoke({ ...args, workspace });
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiTimurAgentAdminConfigSmokeResult = {
      status: 'failed',
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: join(workspace, 'agents'),
      dataDir: join(workspace, 'data'),
      peerId: args.peerId,
      permissions: {
        adminToolsPresent: false,
        privateAllowlistSinglePeer: false,
        selfManageAllowed: false,
        crossAgentDenied: false,
      },
      config: {
        showConfigRead: false,
        operatorConsolePatched: false,
        humanTakeoverPatched: false,
        auditEntries: 0,
        lastModifiedSeen: false,
        backupsCreated: 0,
        tempOnly: true,
      },
      accessControl: {
        pendingListed: false,
        approved: false,
        approvedListed: false,
        revoked: false,
        approvedAfterRevoke: -1,
        tempOnly: true,
      },
      error: errorMessage(err),
    };
    writeResult(stderr, args.json, result);
    return 1;
  } finally {
    if (!args.keepData) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export async function runPiTimurAgentAdminConfigSmoke(input: PiTimurAgentAdminConfigSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentAdminConfigSmokeResult> {
  const agentsDir = join(input.workspace, 'agents');
  const dataDir = join(input.workspace, 'data');
  const auditDir = join(dataDir, 'config-audit');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  cpSync(join(resolve(input.agentsDir), AGENT_ID), join(agentsDir, AGENT_ID), { recursive: true });

  const config = loadAgentYml(join(agentsDir, AGENT_ID));
  const adminTools = [
    'access_control',
    'show_config',
    'manage_human_takeover',
    'manage_operator_console',
  ];
  const adminToolsPresent = adminTools.every((toolName) => (config.mcp_tools ?? []).includes(toolName));
  if (!adminToolsPresent) throw new Error('timur_agent must expose admin/config tools.');
  const privateAllowlistSinglePeer =
    config.safety_profile === 'private' &&
    config.allowlist?.telegram?.length === 1 &&
    config.allowlist.telegram[0] === input.peerId;
  if (!privateAllowlistSinglePeer) {
    throw new Error('timur_agent must remain private and allowlisted to the connected operator Telegram peer.');
  }

  const auditLog = createConfigAuditLog({ auditDir });
  const writer = createAgentConfigWriter({ agentsDir, auditLog, backupKeep: 5 });
  const canManage = (callerId: string, targetId: string) => callerId === targetId;

  const showConfigTool = createShowConfigTool({
    agentId: AGENT_ID,
    writer,
    auditLog,
    canManage,
  });
  const beforeConfig = parseToolJson(await showConfigTool.handler({
    sections: ['all'],
  }), 'show_config before failed');
  const showConfigRead = beforeConfig.agent_id === AGENT_ID &&
    Boolean(beforeConfig.sections?.notifications) &&
    Boolean(beforeConfig.sections?.human_takeover) &&
    Boolean(beforeConfig.sections?.operator_console);

  const operatorConsoleTool = createManageOperatorConsoleTool({
    agentId: AGENT_ID,
    writer,
    canManage,
    sessionKey: input.sessionKey,
  });
  const operatorPatch = parseToolJson(await operatorConsoleTool.handler({
    enabled: true,
    manages: '*',
    capabilities: ['peer_pause', 'delegate', 'escalate'],
  }), 'manage_operator_console patch failed');
  const operatorConsolePatched = operatorPatch.ok === true &&
    operatorPatch.value?.enabled === true &&
    operatorPatch.value?.manages === '*' &&
    Array.isArray(operatorPatch.value?.capabilities) &&
    operatorPatch.value.capabilities.includes('delegate');

  const unauthorized = await operatorConsoleTool.handler({
    target_agent_id: UNAUTHORIZED_TARGET_ID,
    enabled: true,
  });
  const crossAgentDenied = unauthorized.isError === true &&
    unauthorized.content.some((item) => item.text.includes('not authorized'));

  const humanTakeoverTool = createManageHumanTakeoverTool({
    agentId: AGENT_ID,
    writer,
    canManage,
    sessionKey: input.sessionKey,
  });
  const takeoverPatch = parseToolJson(await humanTakeoverTool.handler({
    enabled: true,
    pause_ttl_minutes: 31,
    channels: ['telegram'],
    notification_throttle_minutes: 3,
  }), 'manage_human_takeover patch failed');
  const humanTakeoverPatched = takeoverPatch.ok === true &&
    takeoverPatch.value?.enabled === true &&
    takeoverPatch.value?.pause_ttl_minutes === 31 &&
    Array.isArray(takeoverPatch.value?.channels) &&
    takeoverPatch.value.channels.includes('telegram');

  const afterConfig = parseToolJson(await showConfigTool.handler({
    sections: ['operator_console', 'human_takeover'],
  }), 'show_config after failed');
  const lastModifiedSeen = afterConfig.last_modified?.by === AGENT_ID &&
    afterConfig.last_modified?.source === 'chat' &&
    ['operator_console', 'human_takeover'].includes(String(afterConfig.last_modified?.section));
  const auditEntries = (await auditLog.readRecent(AGENT_ID, { limit: 10 })).length;
  const backupsCreated = countBackups(writer.readFullConfig(AGENT_ID), agentsDir);

  const accessControl = new AccessControl(dataDir);
  accessControl.check(AGENT_ID, PENDING_SENDER_ID, 'telegram', { pairing: { mode: 'approve' } });
  const accessTool = createAccessControlTool(AGENT_ID, accessControl);
  const pendingList = await accessTool.handler({ action: 'list_pending' });
  const pendingListed = toolText(pendingList).includes(PENDING_SENDER_ID);
  const approveResult = await accessTool.handler({ action: 'approve', sender_id: PENDING_SENDER_ID });
  const approved = !approveResult.isError && toolText(approveResult).includes(`Approved: ${PENDING_SENDER_ID}`);
  const approvedList = await accessTool.handler({ action: 'list_approved' });
  const approvedListed = toolText(approvedList).includes(PENDING_SENDER_ID);
  const revokeResult = await accessTool.handler({ action: 'revoke', sender_id: PENDING_SENDER_ID });
  const revoked = !revokeResult.isError && toolText(revokeResult).includes(`Revoked: ${PENDING_SENDER_ID}`);
  const approvedAfterRevoke = accessControl.listApproved(AGENT_ID).length;

  const result: PiTimurAgentAdminConfigSmokeResult = {
    status: 'passed',
    runtime: 'pi',
    agentId: AGENT_ID,
    agentsDir,
    dataDir,
    peerId: input.peerId,
    permissions: {
      adminToolsPresent,
      privateAllowlistSinglePeer,
      selfManageAllowed: operatorConsolePatched && humanTakeoverPatched,
      crossAgentDenied,
    },
    config: {
      showConfigRead,
      operatorConsolePatched,
      humanTakeoverPatched,
      auditEntries,
      lastModifiedSeen,
      backupsCreated,
      tempOnly: true,
    },
    accessControl: {
      pendingListed,
      approved,
      approvedListed,
      revoked,
      approvedAfterRevoke,
      tempOnly: true,
    },
  };
  assertSmokeResult(result);
  return result;
}

export function parsePiTimurAgentAdminConfigSmokeArgs(argv: string[]): PiTimurAgentAdminConfigSmokeArgs {
  const args: PiTimurAgentAdminConfigSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    peerId: DEFAULT_PEER_ID,
    sessionKey: DEFAULT_SESSION_KEY,
    keepData: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--agents-dir':
        args.agentsDir = resolve(requireValue(argv, ++i, '--agents-dir'));
        break;
      case '--peer-id':
        args.peerId = requireValue(argv, ++i, '--peer-id');
        break;
      case '--session-key':
        args.sessionKey = requireValue(argv, ++i, '--session-key');
        break;
      case '--keep-data':
        args.keepData = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parseToolJson(
  result: { isError?: boolean; content: Array<{ type: string; text: string }> },
  message: string,
): Record<string, any> {
  if (result.isError) {
    throw new Error(`${message}: ${toolText(result)}`);
  }
  try {
    return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, any>;
  } catch (err) {
    throw new Error(`${message}: invalid JSON: ${errorMessage(err)}`);
  }
}

function toolText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((item) => item.text).join('\n');
}

function countBackups(_config: unknown, agentsDir: string): number {
  void _config;
  const dir = join(agentsDir, AGENT_ID);
  try {
    return readdirSync(dir).filter((name) => name.startsWith('agent.yml.bak-')).length;
  } catch {
    return 0;
  }
}

function assertSmokeResult(result: PiTimurAgentAdminConfigSmokeResult): void {
  for (const [section, values] of Object.entries({
    permissions: result.permissions,
    config: result.config,
    accessControl: result.accessControl,
  })) {
    for (const [key, value] of Object.entries(values)) {
      if (key === 'auditEntries' || key === 'backupsCreated' || key === 'approvedAfterRevoke') continue;
      if (value !== true) {
        throw new Error(`timur_agent admin/config smoke assertion failed: ${section}.${key}`);
      }
    }
  }
  if (result.config.auditEntries < 2) throw new Error('Expected at least two config audit entries.');
  if (result.config.backupsCreated < 2) throw new Error('Expected config backups for controlled patches.');
  if (result.accessControl.approvedAfterRevoke !== 0) throw new Error('Access control revoke did not clear approved sender.');
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentAdminConfigSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi timur_agent admin/config smoke passed.',
      `permissions: ${JSON.stringify(result.permissions)}`,
      `config: ${JSON.stringify(result.config)}`,
      `accessControl: ${JSON.stringify(result.accessControl)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent admin/config smoke failed: ${result.error ?? 'unknown error'}\n`);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function usage(): string {
  return [
    'Usage: pnpm runtime:pi-timur-agent-admin-config-smoke -- [--json]',
    '',
    'Options:',
    '  --agents-dir <path>  source agents directory containing timur_agent (default: agents)',
    '  --peer-id <id>       expected private Telegram peer id (default: operator peer)',
    '  --session-key <key>  fake operator session key for audit attribution',
    '  --keep-data          keep temp workspace for inspection',
    '  --json               emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentAdminConfigSmokeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
