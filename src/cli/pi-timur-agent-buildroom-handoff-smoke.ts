import 'dotenv/config';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBuildroomHandoffTool } from '../agent/tools/buildroom-handoff.js';
import { createBuildroomSessionSummaryTool } from '../agent/tools/buildroom-session-summary.js';
import { FileArtifactStore } from '../auto-buildroom/artifacts/store.js';
import type { BuildroomArtifact } from '../auto-buildroom/artifacts/model.js';
import { initializeBuildroomStorage } from '../auto-buildroom/storage/init.js';
import { loadAgentYml } from '../config/loader.js';
import { ApprovalBroker } from '../security/approval-broker.js';
import { getProfile } from '../security/profiles/index.js';
import { createCanUseTool } from '../sdk/permissions.js';

const AGENT_ID = 'timur_agent';
const SERVER_NAME = `${AGENT_ID}-tools`;
const ROOM_ID = 'anthroclaw-core';
const DEFAULT_PEER_ID = '48705953';
const DEFAULT_SENDER_ID = '48705953';
const SOURCE_SESSION_ID = 'timur_agent:telegram:default:48705953:buildroom-smoke';
const SUMMARY_NOW = '2026-05-18T07:40:00.000Z';
const HANDOFF_NOW = '2026-05-18T07:41:00.000Z';

interface PiTimurAgentBuildroomHandoffSmokeArgs {
  agentsDir: string;
  peerId: string;
  senderId: string;
  keepData: boolean;
  json: boolean;
  help: boolean;
}

interface PiTimurAgentBuildroomHandoffSmokeDeps {
  makeWorkspace?: () => string;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiTimurAgentBuildroomHandoffSmokeResult {
  status: 'passed' | 'failed';
  runtime: 'pi';
  agentId: string;
  agentsDir: string;
  projectRoot: string;
  peerId: string;
  permissions: {
    buildroomToolsPresent: boolean;
    privateAllowlistSinglePeer: boolean;
    sessionSummaryAllowed: boolean;
    handoffSignalAllowed: boolean;
  };
  summary: {
    submitted: boolean;
    artifactId: string | null;
    sanitized: boolean;
    noRawTranscript: boolean;
    cannotApproveWork: boolean;
    sourceSessionBound: boolean;
    candidateSignals: number;
  };
  handoff: {
    submitted: boolean;
    artifactId: string | null;
    parentLinked: boolean;
    sourceSessionBound: boolean;
    targetBuildroomBound: boolean;
    requestedAction: string | null;
    cannotApprove: boolean;
    cannotBuild: boolean;
  };
  safety: {
    tempOnly: boolean;
    uninitializedFailsClosed: boolean;
    artifactsWritten: number;
  };
  error?: string;
}

export async function runPiTimurAgentBuildroomHandoffSmokeCli(
  argv: string[],
  deps: PiTimurAgentBuildroomHandoffSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiTimurAgentBuildroomHandoffSmokeArgs;

  try {
    args = parsePiTimurAgentBuildroomHandoffSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${errorMessage(err)}\n${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const workspace = deps.makeWorkspace?.() ?? mkdtempSync(join(tmpdir(), 'anthroclaw-pi-timur-agent-buildroom-handoff-'));
  try {
    const result = await runPiTimurAgentBuildroomHandoffSmoke({ ...args, workspace });
    writeResult(stdout, args.json, result);
    return 0;
  } catch (err) {
    const result: PiTimurAgentBuildroomHandoffSmokeResult = {
      status: 'failed',
      runtime: 'pi',
      agentId: AGENT_ID,
      agentsDir: join(workspace, 'agents'),
      projectRoot: join(workspace, 'buildroom-project'),
      peerId: args.peerId,
      permissions: {
        buildroomToolsPresent: false,
        privateAllowlistSinglePeer: false,
        sessionSummaryAllowed: false,
        handoffSignalAllowed: false,
      },
      summary: {
        submitted: false,
        artifactId: null,
        sanitized: false,
        noRawTranscript: false,
        cannotApproveWork: false,
        sourceSessionBound: false,
        candidateSignals: 0,
      },
      handoff: {
        submitted: false,
        artifactId: null,
        parentLinked: false,
        sourceSessionBound: false,
        targetBuildroomBound: false,
        requestedAction: null,
        cannotApprove: false,
        cannotBuild: false,
      },
      safety: {
        tempOnly: true,
        uninitializedFailsClosed: false,
        artifactsWritten: 0,
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

export async function runPiTimurAgentBuildroomHandoffSmoke(input: PiTimurAgentBuildroomHandoffSmokeArgs & {
  workspace: string;
}): Promise<PiTimurAgentBuildroomHandoffSmokeResult> {
  const agentsDir = join(input.workspace, 'agents');
  const projectRoot = join(input.workspace, 'buildroom-project');
  const uninitializedRoot = join(input.workspace, 'uninitialized-buildroom-project');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(uninitializedRoot, { recursive: true });
  cpSync(join(resolve(input.agentsDir), AGENT_ID), join(agentsDir, AGENT_ID), { recursive: true });
  initializeBuildroomStorage({ projectRoot, roomId: ROOM_ID, operatorId: 'telegram:default:48705953' });

  const config = loadAgentYml(join(agentsDir, AGENT_ID));
  const buildroomToolsPresent = [
    'buildroom_submit_session_summary',
    'buildroom_submit_signal',
  ].every((toolName) => (config.mcp_tools ?? []).includes(toolName));
  if (!buildroomToolsPresent) throw new Error('timur_agent must expose Buildroom handoff tools.');
  const privateAllowlistSinglePeer =
    config.safety_profile === 'private' &&
    config.allowlist?.telegram?.length === 1 &&
    config.allowlist.telegram[0] === input.peerId;
  if (!privateAllowlistSinglePeer) {
    throw new Error('timur_agent must remain private and allowlisted to the connected operator Telegram peer.');
  }

  const canUseTool = createCanUseTool({
    agent: {
      id: AGENT_ID,
      config,
      safetyProfile: getProfile(config.safety_profile),
      workspacePath: projectRoot,
    },
    approvalBroker: new ApprovalBroker(),
    sessionContext: {
      channel: 'telegram',
      peerId: input.peerId,
      senderId: input.senderId,
      accountId: 'default',
    },
  });
  const sessionSummaryPermission = await canUseTool(
    `mcp__${SERVER_NAME}__buildroom_submit_session_summary`,
    { user_intent: 'Summarize sanitized operator-lab friction.' },
    { signal: new AbortController().signal, toolUseID: 'timur-agent-buildroom-summary' } as any,
  );
  const handoffPermission = await canUseTool(
    `mcp__${SERVER_NAME}__buildroom_submit_signal`,
    { signal_type: 'friction', summary: 'Route friction', evidence_summary_id: 'placeholder' },
    { signal: new AbortController().signal, toolUseID: 'timur-agent-buildroom-handoff' } as any,
  );
  if (sessionSummaryPermission.behavior !== 'allow') throw new Error('Buildroom session summary permission was not allowed.');
  if (handoffPermission.behavior !== 'allow') throw new Error('Buildroom handoff signal permission was not allowed.');

  const uninitializedTool = createBuildroomSessionSummaryTool({
    projectRoot: uninitializedRoot,
    roomId: ROOM_ID,
    sourceAgentId: AGENT_ID,
    sourceSessionId: SOURCE_SESSION_ID,
    now: () => SUMMARY_NOW,
  });
  const uninitializedResult = await uninitializedTool.handler({
    user_intent: 'This should fail because Buildroom is not initialized.',
  });
  const uninitializedFailsClosed = uninitializedResult.isError === true &&
    toolText(uninitializedResult).includes('buildroom.yml');

  const summaryTool = createBuildroomSessionSummaryTool({
    projectRoot,
    roomId: ROOM_ID,
    sourceAgentId: AGENT_ID,
    sourceSessionId: SOURCE_SESSION_ID,
    now: () => SUMMARY_NOW,
  });
  const summaryResult = await summaryTool.handler({
    user_intent: 'Operator is validating whether timur_agent can hand sanitized runtime signals to Buildroom.',
    observed_friction: [
      'Operator needs a repeatable handoff artifact without granting build authority.',
      'Runtime migration evidence must stay sanitized and linkable.',
    ],
    candidate_signals: [{
      type: 'friction',
      text: 'Buildroom handoff needs explicit no-approval/no-build authority flags.',
      confidence: 'high',
    }],
    evidence_excerpt: 'Sanitized excerpt: timur_agent Buildroom handoff smoke.',
  });
  assertToolOk(summaryResult, 'Buildroom session summary failed');
  const summaryId = extractArtifactId(toolText(summaryResult), 'Buildroom session summary submitted: ');
  const store = new FileArtifactStore({ projectRoot, roomId: ROOM_ID });
  const summaryArtifact = store.readArtifact(summaryId);

  const handoffTool = createBuildroomHandoffTool({
    projectRoot,
    roomId: ROOM_ID,
    sourceAgentId: AGENT_ID,
    sourceSessionId: SOURCE_SESSION_ID,
    now: () => HANDOFF_NOW,
  });
  const handoffResult = await handoffTool.handler({
    signal_type: 'friction',
    summary: 'timur_agent can submit sanitized Buildroom handoff signals without authority escalation.',
    evidence_summary_id: summaryId,
    confidence: 'high',
    requested_action: 'research_only',
  });
  assertToolOk(handoffResult, 'Buildroom handoff signal failed');
  const handoffId = extractArtifactId(toolText(handoffResult), 'Buildroom handoff submitted: ');
  const handoffArtifact = store.readArtifact(handoffId);

  const result: PiTimurAgentBuildroomHandoffSmokeResult = {
    status: 'passed',
    runtime: 'pi',
    agentId: AGENT_ID,
    agentsDir,
    projectRoot,
    peerId: input.peerId,
    permissions: {
      buildroomToolsPresent,
      privateAllowlistSinglePeer,
      sessionSummaryAllowed: sessionSummaryPermission.behavior === 'allow',
      handoffSignalAllowed: handoffPermission.behavior === 'allow',
    },
    summary: {
      submitted: summaryArtifact.type === 'session_summary' && summaryArtifact.status === 'sanitized',
      artifactId: summaryArtifact.id,
      sanitized: summaryArtifact.redaction.rawTranscriptsIncluded === false &&
        summaryArtifact.redaction.secretsRedacted === true,
      noRawTranscript: getNestedBoolean(summaryArtifact, ['payload', 'privacy', 'rawTranscriptIncluded']) === false,
      cannotApproveWork: getNestedBoolean(summaryArtifact, ['payload', 'allowedUse', 'canApproveWork']) === false,
      sourceSessionBound: summaryArtifact.payload.sourceSessionId === SOURCE_SESSION_ID,
      candidateSignals: getNestedArrayLength(summaryArtifact, ['payload', 'summary', 'candidateSignals']),
    },
    handoff: {
      submitted: handoffArtifact.type === 'handoff_signal' && handoffArtifact.status === 'submitted',
      artifactId: handoffArtifact.id,
      parentLinked: handoffArtifact.parentIds.includes(summaryArtifact.id),
      sourceSessionBound: handoffArtifact.payload.sourceSessionId === SOURCE_SESSION_ID,
      targetBuildroomBound: handoffArtifact.payload.targetBuildroom === ROOM_ID,
      requestedAction: typeof handoffArtifact.payload.requestedAction === 'string'
        ? handoffArtifact.payload.requestedAction
        : null,
      cannotApprove: getNestedBoolean(handoffArtifact, ['payload', 'authority', 'canApprove']) === false,
      cannotBuild: getNestedBoolean(handoffArtifact, ['payload', 'authority', 'canBuild']) === false,
    },
    safety: {
      tempOnly: true,
      uninitializedFailsClosed,
      artifactsWritten: store.listArtifacts('session_summary').length + store.listArtifacts('handoff_signal').length,
    },
  };
  assertSmokeResult(result);
  return result;
}

export function parsePiTimurAgentBuildroomHandoffSmokeArgs(argv: string[]): PiTimurAgentBuildroomHandoffSmokeArgs {
  const args: PiTimurAgentBuildroomHandoffSmokeArgs = {
    agentsDir: process.env.OC_AGENTS_DIR ? resolve(process.env.OC_AGENTS_DIR) : resolve('agents'),
    peerId: DEFAULT_PEER_ID,
    senderId: DEFAULT_SENDER_ID,
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
      case '--sender-id':
        args.senderId = requireValue(argv, ++i, '--sender-id');
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

function assertToolOk(
  result: { isError?: boolean; content: Array<{ type: string; text: string }> },
  message: string,
): void {
  if (result.isError) {
    throw new Error(`${message}: ${toolText(result)}`);
  }
}

function toolText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((item) => item.text).join('\n');
}

function extractArtifactId(text: string, prefix: string): string {
  const line = text.split('\n').find((item) => item.startsWith(prefix));
  const id = line?.slice(prefix.length).trim();
  if (!id) throw new Error(`Could not extract artifact id from tool response: ${text}`);
  return id;
}

function getNestedBoolean(artifact: BuildroomArtifact, path: string[]): boolean | undefined {
  let current: unknown = artifact;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'boolean' ? current : undefined;
}

function getNestedArrayLength(artifact: BuildroomArtifact, path: string[]): number {
  let current: unknown = artifact;
  for (const key of path) {
    if (!current || typeof current !== 'object') return 0;
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current.length : 0;
}

function assertSmokeResult(result: PiTimurAgentBuildroomHandoffSmokeResult): void {
  for (const [section, values] of Object.entries({
    permissions: result.permissions,
    summary: result.summary,
    handoff: result.handoff,
    safety: result.safety,
  })) {
    for (const [key, value] of Object.entries(values)) {
      if (key === 'artifactId' || key === 'candidateSignals' || key === 'requestedAction' || key === 'artifactsWritten') continue;
      if (value !== true) {
        throw new Error(`timur_agent Buildroom handoff smoke assertion failed: ${section}.${key}`);
      }
    }
  }
  if (!result.summary.artifactId) throw new Error('Missing session summary artifact id.');
  if (!result.handoff.artifactId) throw new Error('Missing handoff artifact id.');
  if (result.summary.candidateSignals !== 1) throw new Error('Expected exactly one candidate signal.');
  if (result.handoff.requestedAction !== 'research_only') throw new Error('Handoff requested action must remain research_only.');
  if (result.safety.artifactsWritten !== 2) throw new Error('Expected exactly two Buildroom artifacts in temp storage.');
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiTimurAgentBuildroomHandoffSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi timur_agent Buildroom handoff smoke passed.',
      `permissions: ${JSON.stringify(result.permissions)}`,
      `summary: ${JSON.stringify(result.summary)}`,
      `handoff: ${JSON.stringify(result.handoff)}`,
      `safety: ${JSON.stringify(result.safety)}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi timur_agent Buildroom handoff smoke failed: ${result.error ?? 'unknown error'}\n`);
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
    'Usage: pnpm runtime:pi-timur-agent-buildroom-handoff-smoke -- [--json]',
    '',
    'Options:',
    '  --agents-dir <path>  source agents directory containing timur_agent (default: agents)',
    '  --peer-id <id>       expected private Telegram peer id (default: operator peer)',
    '  --sender-id <id>     fake Telegram sender id (default: operator peer)',
    '  --keep-data          keep temp workspace for inspection',
    '  --json               emit JSON',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiTimurAgentBuildroomHandoffSmokeCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`${errorMessage(err)}\n`);
      process.exitCode = 1;
    });
}
