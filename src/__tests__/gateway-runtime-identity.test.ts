import { describe, expect, it } from 'vitest';
import { buildRuntimeIdentityPrompt } from '../gateway.js';

describe('buildRuntimeIdentityPrompt', () => {
  it('prevents non-Anthropic Pi models from self-identifying as Claude', () => {
    const prompt = buildRuntimeIdentityPrompt({
      runtime: 'pi',
      model: 'deepseek/deepseek-v4-pro',
    });

    expect(prompt).toContain('runtime: pi');
    expect(prompt).toContain('model: deepseek/deepseek-v4-pro');
    expect(prompt).toContain('provider: deepseek');
    expect(prompt).toContain('Do not identify yourself as Claude, Anthropic, Sonnet, or Opus');
  });

  it('allows Claude identity only for Anthropic model ids', () => {
    const prompt = buildRuntimeIdentityPrompt({
      runtime: 'pi',
      model: 'anthropic/claude-sonnet-4-6',
    });

    expect(prompt).toContain('provider: anthropic');
    expect(prompt).toContain('You may identify the model as Anthropic/Claude');
  });
});
