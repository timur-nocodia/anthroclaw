import { describe, it, expect } from 'vitest';
import { PluginManifestSchema, parsePluginManifest } from '../manifest-schema.js';

describe('PluginManifestSchema', () => {
  it('accepts minimal valid manifest', () => {
    const result = PluginManifestSchema.safeParse({
      name: 'lcm',
      version: '0.1.0',
      entry: 'dist/index.js',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = PluginManifestSchema.safeParse({ version: '0.1.0', entry: 'dist/index.js' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid semver in version', () => {
    const result = PluginManifestSchema.safeParse({
      name: 'lcm', version: 'not-semver', entry: 'dist/index.js',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name with invalid characters', () => {
    const result = PluginManifestSchema.safeParse({
      name: 'has spaces!', version: '0.1.0', entry: 'dist/index.js',
    });
    expect(result.success).toBe(false);
  });

  it('accepts hooks as event-name → path map', () => {
    const result = PluginManifestSchema.safeParse({
      name: 'lcm', version: '0.1.0', entry: 'dist/index.js',
      hooks: { onAfterQuery: 'dist/hooks/mirror.js' },
    });
    expect(result.success).toBe(true);
  });

  it('parsePluginManifest reads file and validates', async () => {
    const manifest = await parsePluginManifest(
      'src/plugins/__tests__/fixtures/valid-manifest.json'
    );
    expect(manifest.name).toBe('test-plugin');
  });

  it('parsePluginManifest throws on invalid JSON', async () => {
    await expect(
      parsePluginManifest('src/plugins/__tests__/fixtures/invalid-manifest.json')
    ).rejects.toThrow(/invalid|parse|JSON/i);
  });
});
