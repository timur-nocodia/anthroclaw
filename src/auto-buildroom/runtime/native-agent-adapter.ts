import { query } from '@anthroclaw/legacy-claude-agent-sdk';
import type { Options } from '@anthroclaw/legacy-claude-agent-sdk';
import type { BuildroomRuntimeRef } from '../artifacts/model.js';

export interface NativeBuilderRunInput {
  prompt: string;
  model?: string;
  workingDirectory: string;
  allowedTools: string[];
  idempotencyKey: string;
  scopeSummary: string;
  timeoutMs?: number;
}

export type NativeBuilderRunResult =
  | {
      status: 'completed';
      resultText: string;
      changedFiles?: string[];
      runtimeRefs: BuildroomRuntimeRef[];
    }
  | {
      status: 'failed';
      errorType: 'runtime_error' | 'timeout';
      message: string;
      runtimeRefs: BuildroomRuntimeRef[];
    };

export class NativeAgentRuntimeAdapter {
  async runBuilder(input: NativeBuilderRunInput): Promise<NativeBuilderRunResult> {
    const controller = new AbortController();
    const timeoutMs = input.timeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const options: Options = {
      model: input.model ?? 'claude-sonnet-4-6',
      cwd: input.workingDirectory,
      allowedTools: input.allowedTools,
      permissionMode: 'default',
      maxTurns: 1,
      persistSession: false,
      settingSources: ['project'],
      abortController: controller,
      canUseTool: async () => ({
        behavior: 'deny',
        message: 'Native tool approval is not auto-granted by Auto-Buildroom.',
      }),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        excludeDynamicSections: true,
        append: [
          'You are running as the Auto-Buildroom Builder through the native Agent SDK runtime.',
          'Act only inside the approved Buildroom scope.',
          `Approved scope: ${input.scopeSummary}`,
          `Idempotency key: ${input.idempotencyKey}`,
        ].join('\n'),
      },
    };

    const stream = query({ prompt: input.prompt, options });
    const runtimeRefs: BuildroomRuntimeRef[] = [{ runtime: 'native-agent-sdk' }];
    let resultText = '';
    const accumulated: string[] = [];

    try {
      for await (const event of stream) {
        const e = event as Record<string, unknown>;
        captureRuntimeRef(runtimeRefs[0], e);

        if (e.type === 'result' && Boolean(e.is_error) && e.subtype !== 'success') {
          return {
            status: 'failed',
            errorType: 'runtime_error',
            message: runtimeErrorMessage(e),
            runtimeRefs,
          };
        }

        if (e.type === 'result' && typeof e.result === 'string') {
          resultText = e.result.trim();
          break;
        }

        if (e.type === 'assistant') {
          const msg = e.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
          for (const block of msg?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              accumulated.push(block.text);
            }
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          status: 'failed',
          errorType: 'timeout',
          message: `Native Builder runtime timeout after ${timeoutMs}ms`,
          runtimeRefs,
        };
      }
      return {
        status: 'failed',
        errorType: 'runtime_error',
        message: error instanceof Error ? error.message : String(error),
        runtimeRefs,
      };
    } finally {
      clearTimeout(timer);
      stream.close?.();
    }

    return {
      status: 'completed',
      resultText: resultText || accumulated.join('').trim(),
      runtimeRefs,
    };
  }
}

function captureRuntimeRef(ref: BuildroomRuntimeRef, event: Record<string, unknown>): void {
  if (typeof event.run_id === 'string') ref.runId = event.run_id;
  if (typeof event.session_id === 'string') ref.sessionId = event.session_id;
}

function runtimeErrorMessage(event: Record<string, unknown>): string {
  const subtype = typeof event.subtype === 'string' ? event.subtype : 'runtime_error';
  const errors = Array.isArray(event.errors)
    ? event.errors.filter((item): item is string => typeof item === 'string')
    : [];
  return errors.length ? `${subtype}: ${errors.join('; ')}` : subtype;
}
