import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Agent } from '../agent/agent.js';
import { buildSdkOptions } from '../sdk/options.js';
import { CUTOFF_DECISION_REASON } from '../sdk/cutoff.js';
import { publicProfile } from '../security/profiles/index.js';
import { ApprovalBroker } from '../security/approval-broker.js';

/**
 * End-to-end fixture test for the v0.8.0 capability cutoff (Subsystem 1,
 * Phase 6 / Task 12).
 *
 * This pins the seven cutoff invariants — the contract every agent's SDK
 * options must satisfy after `buildSdkOptions(...)` returns:
 *
 *   1. enabledMcpjsonServers: []
 *   2. settingSources: []
 *   3. additionalDirectories: []
 *   4. cwd points at the agent's own workspace dir
 *   5. env has been scrubbed (operator credentials gone, harmless TZ kept)
 *   6. mcpServers contains exactly the agent's in-process SDK MCP server
 *      (`<id>-tools`) by default; declared external_mcp_servers add prefix-
 *      globbed entries to canUseTool's allow list.
 *   7. canUseTool denies a Claude.ai-style mcp__claude_ai_*__* tool the agent
 *      did not declare; it allows mcp__<declared>__* via prefix glob.
 *
 * Implementation note (deviation from plan). The plan's Task 12 sketch
 * describes a "real Gateway with mocked SDK query()" harness that captures
 * the options arg from the SDK call. The repo has no such harness today —
 * existing Gateway tests either patch `Gateway.prototype` (e.g.
 * `cron-session-continuity.test.ts`) or instantiate Gateway with `as any`
 * for a single helper call; none drive a full message dispatch through to
 * a mocked `query()`. Building one is out of scope for this task and would
 * not improve confidence in the cutoff machinery itself, which is what's
 * being pinned. Instead this test calls `buildSdkOptions(...)` directly —
 * the function that owns the cutoff pipeline (it ends with
 * `return applyCutoffOptions(options, agent)`). Same invariants, fewer
 * moving parts. The fallback decision is documented in the commit message.
 */

function fakeAgent(opts: {
  id?: string;
  externalMcpServers?: Record<string, unknown>;
} = {}): Agent {
  const id = opts.id ?? 'a1';
  return {
    id,
    config: {
      safety_profile: publicProfile.name,
      model: 'claude-sonnet-4-6',
      sdk: {},
      mcp_tools: ['memory_search', 'send_message'],
      external_mcp_servers: opts.externalMcpServers,
    },
    safetyProfile: publicProfile,
    workspacePath: '/tmp/loader-supplied-path-should-be-overridden',
    tools: [],
    mcpServer: { name: `${id}-tools`, instance: {} },
  } as unknown as Agent;
}

describe('capability-cutoff e2e — full buildSdkOptions pipeline pins all 7 invariants', () => {
  let agentsRoot: string;
  let prevAgentsDir: string | undefined;
  let prevGoogleCalId: string | undefined;
  let prevMasterKey: string | undefined;
  let prevTz: string | undefined;

  beforeEach(() => {
    // Sandbox the agents root so cwd/sibling logic resolves under tmp,
    // not the real repo's `agents/` (which would couple this test to
    // unrelated agent fixtures and leak filesystem state).
    agentsRoot = mkdtempSync(join(tmpdir(), 'cutoff-e2e-'));
    prevAgentsDir = process.env.OC_AGENTS_DIR;
    process.env.OC_AGENTS_DIR = agentsRoot;

    // Seed denylisted env vars on process.env so we can assert the cutoff
    // scrubs them. `buildSdkOptions` does not set Options.env, so
    // `applyCutoffOptions` falls back to `scrubAgentEnv(process.env)`.
    prevGoogleCalId = process.env.GOOGLE_CALENDAR_ID;
    prevMasterKey = process.env.ANTHROCLAW_MASTER_KEY;
    prevTz = process.env.TZ;
    process.env.GOOGLE_CALENDAR_ID = 'should-be-scrubbed';
    process.env.ANTHROCLAW_MASTER_KEY = 'should-be-scrubbed';
    process.env.TZ = 'UTC';
  });

  afterEach(() => {
    process.env.OC_AGENTS_DIR = prevAgentsDir;
    if (prevGoogleCalId === undefined) delete process.env.GOOGLE_CALENDAR_ID;
    else process.env.GOOGLE_CALENDAR_ID = prevGoogleCalId;
    if (prevMasterKey === undefined) delete process.env.ANTHROCLAW_MASTER_KEY;
    else process.env.ANTHROCLAW_MASTER_KEY = prevMasterKey;
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
    rmSync(agentsRoot, { recursive: true, force: true });
  });

  it('produces sanitized SDK Options for a normal-case agent (no external_mcp_servers)', () => {
    const agent = fakeAgent({ id: 'a1' });
    const options = buildSdkOptions({
      agent,
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: 'peer1' },
      // trustedBypass=false here — the canUseTool field is the *composed*
      // gate (upstream profile gate + cutoff). The non-trusted path is the
      // common operator path; we assert the shape, not behaviour, here.
    });

    // Invariant 1: no .mcp.json discovery surface.
    // (Field is not on the top-level Options type — accessed via cast,
    //  matches applyCutoffOptions defence-in-depth.)
    expect((options as Record<string, unknown>).enabledMcpjsonServers).toEqual([]);

    // Invariant 2: all upstream Claude settings ignored.
    expect(options.settingSources).toEqual([]);

    // Invariant 3: no upward path access.
    expect(options.additionalDirectories).toEqual([]);

    // Invariant 4: cwd is the canonical agent workspace dir, NOT
    // agent.workspacePath (which the loader could regress).
    expect(options.cwd).toBe(resolve(agentsRoot, 'a1'));
    expect(options.cwd).toMatch(/[\\/]a1$/);

    // Invariant 5: env scrubbed.
    expect(options.env).toBeDefined();
    expect(options.env?.GOOGLE_CALENDAR_ID).toBeUndefined();
    expect(options.env?.ANTHROCLAW_MASTER_KEY).toBeUndefined();
    // Sanity: scrub is denylist-based, not allowlist — TZ stays.
    expect(options.env?.TZ).toBe('UTC');

    // Invariant 6: mcpServers carries ONLY the agent's own in-process SDK
    // MCP server (and any external_mcp_servers it declared, here: none).
    // Plan asserted `mcpServers === {}` which is wrong — buildSdkOptions
    // always wires the agent's own server.
    expect(options.mcpServers).toBeDefined();
    expect(Object.keys(options.mcpServers!)).toEqual(['a1-tools']);

    // Invariant 7 (shape only — exercised properly in the next two tests):
    // canUseTool is installed.
    expect(typeof options.canUseTool).toBe('function');
  });

  it('canUseTool denies a Claude.ai-style tool the agent did not declare (cutoff-as-sole-gate)', async () => {
    // Use trustedBypass=true so canUseTool is the cutoff gate alone (no
    // upstream profile gate composed in front). This isolates the cutoff
    // assertion: a public-profile upstream would also deny but with a
    // different decisionReason; we want to pin the cutoff's own reason
    // string `capability_cutoff` so SIEM rules / hook listeners that match
    // on it cannot silently break.
    const agent = fakeAgent({ id: 'a1' });
    const options = buildSdkOptions({
      agent,
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: 'peer1' },
      trustedBypass: true,
    });

    const ctx = { signal: new AbortController().signal, suggestions: [] };
    const decision = await options.canUseTool!(
      'mcp__claude_ai_Google_Calendar__list_events',
      {},
      ctx as unknown as Parameters<NonNullable<typeof options.canUseTool>>[2],
    );
    expect(decision.behavior).toBe('deny');
    if (decision.behavior === 'deny') {
      expect((decision as Record<string, unknown>).decisionReason).toMatchObject({
        type: 'other',
        reason: CUTOFF_DECISION_REASON,
      });
    }
  });

  it('allows mcp__<server>__* via prefix glob when external_mcp_servers declares the server', async () => {
    // Same trustedBypass=true rationale as the deny test: we are pinning
    // the cutoff gate's behaviour for a tool whose name matches the
    // declared external server's prefix glob.
    const agent = fakeAgent({
      id: 'a1',
      externalMcpServers: {
        google_calendar: { type: 'http', url: 'http://example/mcp' },
      },
    });
    const options = buildSdkOptions({
      agent,
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: 'peer1' },
      trustedBypass: true,
    });

    // Sanity: the external server is reflected in mcpServers.
    expect(Object.keys(options.mcpServers!).sort()).toEqual(['a1-tools', 'google_calendar']);

    const ctx = { signal: new AbortController().signal, suggestions: [] };
    const decision = await options.canUseTool!(
      'mcp__google_calendar__list_events',
      {},
      ctx as unknown as Parameters<NonNullable<typeof options.canUseTool>>[2],
    );
    expect(decision.behavior).toBe('allow');
  });
});
