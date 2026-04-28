import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  PluginManifest, PluginContext, ContextEngine, PluginEntryModule,
  PluginInstance, RunSubagentOpts, HookEvent, HookHandler, PluginMcpTool
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
    const engine: ContextEngine = {};
    expect(engine).toBeDefined();
  });

  it('PluginEntryModule.register accepts PluginContext and returns PluginInstance', () => {
    const fakeRegister: PluginEntryModule['register'] = async (ctx) => {
      expectTypeOf(ctx).toEqualTypeOf<PluginContext>();
      return {} as PluginInstance;
    };
    expect(typeof fakeRegister).toBe('function');
  });

  it('HookEvent matches anthroclaw HookEmitter events subset', () => {
    const evt: HookEvent = 'on_after_query';
    expect(evt).toBe('on_after_query');
  });
});
