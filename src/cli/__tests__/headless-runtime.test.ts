import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalConfigSchema } from '../../config/schema.js';
import {
  parseHeadlessRuntimeCliArgs,
  runHeadlessRuntimeCli,
} from '../headless-runtime.js';

describe('headless runtime CLI', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-headless-runtime-cli-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('uses runtime.headless.provider from config for smoke runs', async () => {
    const review = vi.fn(async () => 'pi-ok');
    const loadConfig = vi.fn(() => GlobalConfigSchema.parse({
      defaults: { model: 'claude-haiku-4-5' },
      runtime: { headless: { provider: 'pi' } },
    }));
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runHeadlessRuntimeCli([
      '--config', join(root, 'config.yml'),
      '--data', join(root, 'data'),
      '--prompt', 'hello',
    ], { review, loadConfig, stdout, stderr });

    expect(code).toBe(0);
    expect(stdout.text()).toBe('pi-ok\n');
    expect(stderr.text()).toBe('');
    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'hello',
      model: 'claude-haiku-4-5',
      runtime: 'pi',
      purpose: 'headless runtime smoke',
      toolDenyMessage: 'Tools disabled for headless runtime smoke.',
    }));
  });

  it('lets --runtime override config provider explicitly', async () => {
    const review = vi.fn(async () => 'claude-ok');
    const loadConfig = vi.fn(() => GlobalConfigSchema.parse({
      runtime: { headless: { provider: 'pi' } },
    }));

    await expect(runHeadlessRuntimeCli([
      '--prompt', 'hello',
      '--runtime', 'claude-agent-sdk',
    ], { review, loadConfig, stdout: createWriter(), stderr: createWriter() }))
      .resolves.toBe(0);

    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'claude-agent-sdk',
    }));
  });

  it('can read the prompt from a file', async () => {
    const promptPath = join(root, 'prompt.txt');
    writeFileSync(promptPath, 'from file', 'utf-8');
    const review = vi.fn(async () => 'ok');

    await runHeadlessRuntimeCli([
      '--prompt-file', promptPath,
    ], {
      review,
      loadConfig: vi.fn(() => GlobalConfigSchema.parse({})),
      stdout: createWriter(),
      stderr: createWriter(),
    });

    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'from file',
    }));
  });

  it('rejects missing prompt input before loading config', async () => {
    const loadConfig = vi.fn(() => GlobalConfigSchema.parse({}));
    const stderr = createWriter();

    const code = await runHeadlessRuntimeCli([], {
      review: vi.fn(),
      loadConfig,
      stdout: createWriter(),
      stderr,
    });

    expect(code).toBe(2);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(stderr.text()).toContain('Provide exactly one of --prompt or --prompt-file.');
  });

  it('parses runtime flags narrowly', () => {
    expect(parseHeadlessRuntimeCliArgs(['--prompt', 'p', '--runtime', 'pi']).runtime).toBe('pi');
    expect(() => parseHeadlessRuntimeCliArgs(['--prompt', 'p', '--runtime', 'other']))
      .toThrow(/Unknown headless runtime provider/);
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
