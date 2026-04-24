import { describe, it, expect } from 'vitest';
import { createSSEStream } from '@/lib/sse';

async function readStream(response: Response): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const lines: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    lines.push(text);
  }

  return lines;
}

describe('createSSEStream', () => {
  it('returns Response with correct SSE headers', () => {
    const response = createSSEStream(async (_send, close) => {
      close();
    });

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');
  });

  it('sends JSON-encoded events with data: prefix', async () => {
    const response = createSSEStream(async (send, close) => {
      send({ type: 'hello', value: 42 });
      send({ type: 'world', list: [1, 2, 3] });
      close();
    });

    const chunks = await readStream(response);
    const combined = chunks.join('');

    expect(combined).toContain('data: {"type":"hello","value":42}\n\n');
    expect(combined).toContain('data: {"type":"world","list":[1,2,3]}\n\n');
  });

  it('handles errors in handler', async () => {
    const response = createSSEStream(async (_send, _close) => {
      throw new Error('test error');
    });

    const chunks = await readStream(response);
    const combined = chunks.join('');

    expect(combined).toContain('error');
    expect(combined).toContain('test error');
  });

  it('sends string data as JSON', async () => {
    const response = createSSEStream(async (send, close) => {
      send('just a string');
      close();
    });

    const chunks = await readStream(response);
    const combined = chunks.join('');

    expect(combined).toContain('data: "just a string"\n\n');
  });
});
