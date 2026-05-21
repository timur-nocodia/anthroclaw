import { describe, it, expect } from 'vitest';
import { extractApiError } from '../events.js';

const FIXTURE_401 = {
  type: 'assistant',
  uuid: '1c0598a3-92fd-4932-b757-f96b8e8cc159',
  timestamp: '2026-05-21T11:26:34.043Z',
  message: {
    id: '23d610d4-1b8f-4864-8ed0-120da913ea0d',
    model: '<synthetic>',
    role: 'assistant',
    stop_reason: 'stop_sequence',
    stop_sequence: '',
    type: 'message',
    content: [
      {
        type: 'text',
        text: 'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"},"request_id":"req_011CbFdevSxKx3EY5GmsiVMe"}',
      },
    ],
  },
  error: 'authentication_failed',
  isApiErrorMessage: true,
  apiErrorStatus: 401,
};

describe('extractApiError', () => {
  it('returns null for a normal assistant message', () => {
    const event = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Привет!' }],
        model: 'claude-opus-4-7',
      },
    };
    expect(extractApiError(event)).toBeNull();
  });

  it('returns null for non-assistant event types', () => {
    expect(extractApiError({ type: 'result', result: 'ok' })).toBeNull();
    expect(extractApiError({ type: 'system', subtype: 'init' })).toBeNull();
  });

  it('detects the 401 synthetic assistant message from prod transcript', () => {
    const detail = extractApiError(FIXTURE_401);
    expect(detail).not.toBeNull();
    expect(detail?.status).toBe(401);
    expect(detail?.errorType).toBe('authentication_error');
    expect(detail?.requestId).toBe('req_011CbFdevSxKx3EY5GmsiVMe');
    expect(detail?.rawText).toContain('Failed to authenticate');
  });

  it('detects api error by flag even when error text cannot be parsed', () => {
    const detail = extractApiError({
      type: 'assistant',
      message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'plain garbage' }] },
      isApiErrorMessage: true,
      apiErrorStatus: 529,
    });
    expect(detail).not.toBeNull();
    expect(detail?.status).toBe(529);
    expect(detail?.errorType).toBeNull();
    expect(detail?.requestId).toBeNull();
  });

  it('is401 helper distinguishes 401 from other api errors', () => {
    expect(extractApiError(FIXTURE_401)?.is401).toBe(true);
    const event500 = { ...FIXTURE_401, apiErrorStatus: 500 };
    expect(extractApiError(event500)?.is401).toBe(false);
  });
});
