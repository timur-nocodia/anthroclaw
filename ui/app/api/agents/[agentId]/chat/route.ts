import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, handleAuthError } from '@/lib/require-auth';
import { getGateway } from '@/lib/gateway';
import { createSSEStream } from '@/lib/sse';
import { ValidationError } from '@/lib/agents';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    await requireAuth();
  } catch (err) {
    return handleAuthError(err);
  }

  const { agentId } = await params;

  let body: { message: string; sessionId?: string; context?: { channel?: string; chatType?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { message, sessionId, context } = body;

  if (!message || typeof message !== 'string') {
    return NextResponse.json(
      { error: 'invalid_request', message: '"message" is required' },
      { status: 400 },
    );
  }

  return createSSEStream(async (send, close) => {
    try {
      const gw = await getGateway();

      await gw.dispatchWebUI(agentId, message, sessionId, context ?? {}, {
        onText(chunk: string) {
          send({ type: 'text', content: chunk });
        },
        onToolCall(name: string, input: Record<string, unknown>) {
          send({ type: 'tool_call', name, input });
        },
        onToolResult(name: string, output: string) {
          send({ type: 'tool_result', name, output });
        },
        onPartialText(chunk: string) {
          send({ type: 'partial_text', content: chunk });
        },
        onPromptSuggestion(suggestion: string) {
          send({ type: 'prompt_suggestion', suggestion });
        },
        onTaskProgress(progress) {
          send({ type: 'task_progress', ...progress });
        },
        onTaskNotification(notification) {
          send({ type: 'task_notification', ...notification });
        },
        onHookEvent(event) {
          send({ type: event.subtype, ...event });
        },
        onDone(sid: string, totalTokens: number) {
          send({ type: 'done', sessionId: sid, totalTokens });
          close();
        },
        onError(err: Error) {
          send({ type: 'error', message: err.message });
          close();
        },
      });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      close();
    }
  });
}
