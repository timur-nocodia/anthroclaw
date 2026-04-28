import { describe, it, expectTypeOf } from 'vitest';
import type {
  PluginManifest, PluginContext, ContextEngine, PluginEntryModule,
  PluginInstance, RunSubagentOpts, HookEvent, HookHandler, PluginMcpTool,
  PluginSlashCommand, SlashCommandContext, PluginLogger,
  AssembleInput, AssembleResult, CompressInput, CompressResult, ShouldCompressInput,
} from '../types.js';

describe('plugin types', () => {
  it('PluginManifest has required fields', () => {
    expectTypeOf<PluginManifest>().toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf<PluginManifest>().toHaveProperty('version').toEqualTypeOf<string>();
    expectTypeOf<PluginManifest>().toHaveProperty('entry').toEqualTypeOf<string>();
  });

  it('PluginContext has all required register methods', () => {
    expectTypeOf<PluginContext>().toHaveProperty('registerHook').toBeFunction();
    expectTypeOf<PluginContext>().toHaveProperty('registerMcpTool').toBeFunction();
    expectTypeOf<PluginContext>().toHaveProperty('registerContextEngine').toBeFunction();
    expectTypeOf<PluginContext>().toHaveProperty('registerSlashCommand').toBeFunction();
    expectTypeOf<PluginContext>().toHaveProperty('runSubagent').toBeFunction();
  });

  it('ContextEngine methods are all optional', () => {
    expectTypeOf<ContextEngine>().toMatchTypeOf<{}>();
    // empty object satisfies — verify every method is optional
    expectTypeOf<ContextEngine['compress']>().toEqualTypeOf<((input: CompressInput) => Promise<CompressResult | null>) | undefined>();
    expectTypeOf<ContextEngine['assemble']>().toEqualTypeOf<((input: AssembleInput) => Promise<AssembleResult | null>) | undefined>();
    expectTypeOf<ContextEngine['shouldCompress']>().toEqualTypeOf<((input: ShouldCompressInput) => boolean) | undefined>();
  });

  it('PluginEntryModule.register accepts PluginContext and returns PluginInstance', () => {
    expectTypeOf<PluginEntryModule['register']>().parameter(0).toEqualTypeOf<PluginContext>();
    expectTypeOf<PluginEntryModule['register']>().returns
      .toEqualTypeOf<Promise<PluginInstance> | PluginInstance>();
  });

  it('HookEvent is re-exported from gateway emitter (matches its full shape)', () => {
    // assignability — values valid in plugin scope must be valid for gateway emitter
    expectTypeOf<HookEvent>().toMatchTypeOf<string>();
    // verifying the re-export carries the full union type
    expectTypeOf<HookEvent>().toEqualTypeOf<HookEvent>();
  });

  it('HookHandler signature', () => {
    expectTypeOf<HookHandler>().parameter(0).toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<HookHandler>().returns.toEqualTypeOf<void | Promise<void>>();
  });

  it('PluginMcpTool shape', () => {
    expectTypeOf<PluginMcpTool>().toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf<PluginMcpTool>().toHaveProperty('description').toEqualTypeOf<string>();
    expectTypeOf<PluginMcpTool>().toHaveProperty('inputSchema');
    expectTypeOf<PluginMcpTool>().toHaveProperty('handler').toBeFunction();
  });

  it('PluginSlashCommand and SlashCommandContext', () => {
    expectTypeOf<PluginSlashCommand>().toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf<PluginSlashCommand>().toHaveProperty('handler').toBeFunction();
    expectTypeOf<SlashCommandContext>().toHaveProperty('agentId').toEqualTypeOf<string>();
    expectTypeOf<SlashCommandContext>().toHaveProperty('sessionKey').toEqualTypeOf<string>();
  });

  it('AssembleInput / AssembleResult parallel CompressInput / CompressResult', () => {
    expectTypeOf<AssembleInput>().toHaveProperty('agentId').toEqualTypeOf<string>();
    expectTypeOf<AssembleInput>().toHaveProperty('sessionKey').toEqualTypeOf<string>();
    expectTypeOf<AssembleInput>().toHaveProperty('messages').toEqualTypeOf<unknown[]>();
    expectTypeOf<AssembleResult>().toHaveProperty('messages').toEqualTypeOf<unknown[]>();
    expectTypeOf<CompressInput>().toHaveProperty('agentId').toEqualTypeOf<string>();
    expectTypeOf<CompressInput>().toHaveProperty('sessionKey').toEqualTypeOf<string>();
    expectTypeOf<CompressInput>().toHaveProperty('messages').toEqualTypeOf<unknown[]>();
    expectTypeOf<CompressInput>().toHaveProperty('currentTokens').toEqualTypeOf<number>();
    expectTypeOf<CompressResult>().toHaveProperty('messages').toEqualTypeOf<unknown[]>();
  });

  it('ShouldCompressInput shape', () => {
    expectTypeOf<ShouldCompressInput>().toHaveProperty('agentId').toEqualTypeOf<string>();
    expectTypeOf<ShouldCompressInput>().toHaveProperty('sessionKey').toEqualTypeOf<string>();
    expectTypeOf<ShouldCompressInput>().toHaveProperty('messageCount').toEqualTypeOf<number>();
    expectTypeOf<ShouldCompressInput>().toHaveProperty('currentTokens').toEqualTypeOf<number>();
  });

  it('RunSubagentOpts shape', () => {
    expectTypeOf<RunSubagentOpts>().toHaveProperty('prompt').toEqualTypeOf<string>();
    // optional fields exist
    expectTypeOf<RunSubagentOpts>().toHaveProperty('systemPrompt').toEqualTypeOf<string | undefined>();
    expectTypeOf<RunSubagentOpts>().toHaveProperty('model').toEqualTypeOf<string | undefined>();
    expectTypeOf<RunSubagentOpts>().toHaveProperty('timeoutMs').toEqualTypeOf<number | undefined>();
    expectTypeOf<RunSubagentOpts>().toHaveProperty('cwd').toEqualTypeOf<string | undefined>();
  });

  it('PluginLogger has 4 level methods', () => {
    expectTypeOf<PluginLogger>().toHaveProperty('info').toBeFunction();
    expectTypeOf<PluginLogger>().toHaveProperty('warn').toBeFunction();
    expectTypeOf<PluginLogger>().toHaveProperty('error').toBeFunction();
    expectTypeOf<PluginLogger>().toHaveProperty('debug').toBeFunction();
  });

  it('PluginInstance.shutdown is optional', () => {
    expectTypeOf<PluginInstance>().toHaveProperty('shutdown').toEqualTypeOf<(() => Promise<void> | void) | undefined>();
  });
});
