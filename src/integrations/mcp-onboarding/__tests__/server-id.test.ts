import { describe, expect, it } from 'vitest';
import { deriveServerId } from '../server-id.js';

describe('deriveServerId', () => {
  it.each([
    ['https://mcp.postmypost.io/mcp', [], 'postmypost'],
    ['https://api.openai.com/mcp', [], 'openai'],
    ['https://tools.example.co.uk', [], 'tools'],
    ['https://EXAMPLE.com/x', [], 'example'],
    ['https://my-server.example.com', [], 'my-server'],
    ['https://postmypost.io', ['postmypost'], 'postmypost-2'],
    ['https://postmypost.io', ['postmypost', 'postmypost-2'], 'postmypost-3'],
  ] as const)('deriveServerId(%s, taken=%j) = %s', (url, taken, expected) => {
    expect(deriveServerId(url, new Set(taken))).toEqual(expected);
  });

  it('falls back to srv-<hash8> for IP host', () => {
    expect(deriveServerId('http://192.168.1.10:8080/mcp', new Set())).toMatch(
      /^srv-[0-9a-f]{8}$/,
    );
  });
});
