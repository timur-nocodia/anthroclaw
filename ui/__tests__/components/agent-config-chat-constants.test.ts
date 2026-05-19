import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(
  process.cwd(),
  'app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx',
);
const SETTINGS_PAGE_PATH = resolve(
  process.cwd(),
  'app/(dashboard)/fleet/[serverId]/settings/page.tsx',
);
const AGENTS_LIST_PAGE_PATH = resolve(
  process.cwd(),
  'app/(dashboard)/fleet/[serverId]/agents/page.tsx',
);
const CHAT_PAGE_PATH = resolve(
  process.cwd(),
  'app/(dashboard)/fleet/[serverId]/chat/[agentId]/page.tsx',
);
const FLEET_PAGE_PATH = resolve(
  process.cwd(),
  'app/(dashboard)/fleet/page.tsx',
);
const SERVER_CARD_PATH = resolve(process.cwd(), 'components/server-card.tsx');

describe('agent config page — chat profile constants', () => {
  const source = readFileSync(PAGE_PATH, 'utf-8');

  it('SAFETY_PROFILES array includes chat_like_anthroclaw', () => {
    expect(source).toMatch(/value:\s*["']chat_like_anthroclaw["']/);
  });

  it('chat option appears before public/trusted/private in SAFETY_PROFILES', () => {
    // Extract the SAFETY_PROFILES array block to scope ordering checks within it
    const profilesMatch = source.match(/const SAFETY_PROFILES\s*=\s*\[[\s\S]*?\];/);
    expect(profilesMatch).toBeTruthy();
    const profilesBlock = profilesMatch![0];
    const chatIdx = profilesBlock.indexOf('"chat_like_anthroclaw"');
    const publicIdx = profilesBlock.indexOf('"public"');
    const trustedIdx = profilesBlock.indexOf('"trusted"');
    const privateIdx = profilesBlock.indexOf('"private"');
    expect(chatIdx).toBeGreaterThan(0);
    expect(chatIdx).toBeLessThan(publicIdx);
    expect(chatIdx).toBeLessThan(trustedIdx);
    expect(chatIdx).toBeLessThan(privateIdx);
  });

  it('SAFETY_PROFILE_TOOLTIP has chat_like_anthroclaw entry', () => {
    expect(source).toMatch(/chat_like_anthroclaw:\s*\n?\s*["'`]/);
  });

  it('chat tooltip mentions warm conversational tone', () => {
    const match = source.match(/chat_like_anthroclaw:[\s\S]{0,800}?["']\s*,/);
    expect(match).toBeTruthy();
    if (match) {
      const block = match[0].toLowerCase();
      expect(block).toMatch(/warm|conversational/);
      expect(block).toContain('default for new agents');
    }
  });

  it('useState fallback for safety_profile defaults to chat_like_anthroclaw', () => {
    expect(source).toContain('normalizeSafetyProfile(agent.safety_profile)');
  });

  it('AgentConfig type widens safety_profile to include chat_like_anthroclaw', () => {
    expect(source).toMatch(/type SafetyProfileValue =[^;\n]*chat_like_anthroclaw/);
    expect(source).toMatch(/safety_profile\?: SafetyProfileValue \| ['"]chat_like_openclaw['"]/);
  });

  it('model selector uses runtime model options instead of Anthropic-only options', () => {
    expect(source).toContain('@/lib/runtime-models');
    expect(source).not.toContain('@/lib/anthropic-models');
    expect(source).toContain('withCurrentRuntimeModelOption(STATIC_RUNTIME_MODEL_OPTIONS, cfg.model)');
  });

  it('agent header and config expose effective runtime provider and capability groups', () => {
    expect(source).toContain('effective runtime: {effectiveProvider}');
    expect(source).toContain('Runtime provider override');
    expect(source).toContain('Side-effect capability groups');
    expect(source).toContain('inferAgentCapabilityGroups');
  });

  it('legacy SDK controls are quarantined as compatibility diagnostics', () => {
    expect(source).toContain('Legacy fallback diagnostics');
    expect(source).toContain('Runtime v1 + Pi remains the primary harness path.');
  });

  it('uses runtime-neutral copy outside the explicit legacy diagnostics surface', () => {
    expect(source).toContain('runtime run is interrupted and aborted');
    expect(source).toContain('agent prompt file is appended');
    expect(source).toContain('selected runtime and runs due tasks');
    expect(source).not.toContain('SDK Query');
    expect(source).not.toContain('SDK delegation surface policy');
    expect(source).not.toContain('SDK Agent tool description');
    expect(source).not.toContain('mutate SDK sessions');
    expect(source).not.toContain('through the SDK path');
  });

  it('personality field appears in cfg state initializer', () => {
    expect(source).toMatch(/personality:\s*agent\.personality/);
  });

  it('Personality textarea is conditional on chat profile', () => {
    expect(source).toMatch(
      /cfg\.safety_profile\s*===\s*['"]chat_like_anthroclaw['"]\s*&&[\s\S]{0,200}<Field[\s\S]{0,200}label=["']Personality["']/,
    );
  });
});

describe('settings page — runtime primary surface', () => {
  const source = readFileSync(SETTINGS_PAGE_PATH, 'utf-8');

  it('routes primary runtime setup to the Runtime page instead of embedding legacy auth controls', () => {
    expect(source).toContain('Runtime setup moved');
    expect(source).toContain('Open Runtime');
    expect(source).toContain('/runtime');
    expect(source).not.toContain('@/components/settings/ClaudeAuthPanel');
  });

  it('advanced settings show generic runtime execution controls before legacy active input diagnostics', () => {
    expect(source).toContain('Runtime execution controls');
    expect(source).toContain('Legacy active input diagnostics');
    expect(source.indexOf('Runtime execution controls')).toBeLessThan(source.indexOf('Legacy active input diagnostics'));
    expect(source).toContain('Side-effect gate harness');
  });
});

describe('agents list page — runtime model creation', () => {
  const source = readFileSync(AGENTS_LIST_PAGE_PATH, 'utf-8');

  it('uses runtime model registry for new agents', () => {
    expect(source).toContain('@/lib/runtime-models');
    expect(source).toContain('/runtime/models');
    expect(source).toContain('models={modelOptions}');
    expect(source).toContain('New agents write an explicit Pi runtime override.');
    expect(source).not.toMatch(/const MODELS\s*=/);
  });

  it('shows effective provider in the list table', () => {
    expect(source).toContain('<span>Runtime</span>');
    expect(source).toContain('effectiveProvider(a, defaultProvider)');
    expect(source).toContain('ProviderBadge');
    expect(source).toContain('legacy fallback');
  });
});

describe('chat page — runtime-neutral diagnostics copy', () => {
  const source = readFileSync(CHAT_PAGE_PATH, 'utf-8');

  it('does not expose legacy Claude SDK copy in runtime diagnostics', () => {
    expect(source).toContain('active runtime records delegated work');
    expect(source).toContain('No runtime transcript loaded yet');
    expect(source).not.toContain('Claude Agent SDK emits');
    expect(source).not.toContain('No SDK transcript loaded');
  });

  it('labels persisted session ids as runtime metadata, not SDK metadata', () => {
    expect(source).toContain('label="runtime"');
    expect(source).not.toContain('label="sdk"');
  });
});

describe('fleet overview — runtime health', () => {
  const fleetSource = readFileSync(FLEET_PAGE_PATH, 'utf-8');
  const cardSource = readFileSync(SERVER_CARD_PATH, 'utf-8');

  it('fetches runtime readiness and expansion progress per server', () => {
    expect(fleetSource).toContain('/runtime/status');
    expect(fleetSource).toContain('/runtime/expansion-status');
    expect(fleetSource).toContain('progressPercent');
  });

  it('links unhealthy runtime states to the runtime page', () => {
    expect(fleetSource).toContain('runtimeLinkForServer');
    expect(fleetSource).toContain('RuntimeHealthBadge');
    expect(cardSource).toContain('/runtime');
    expect(cardSource).toContain('RuntimeCardBadge');
  });
});
