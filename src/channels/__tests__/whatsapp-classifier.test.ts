import { describe, it, expect } from 'vitest';
import { classifyFromMe } from '../whatsapp-classifier.js';

describe('classifyFromMe', () => {
  it('returns ignore for reaction', () => {
    const msg: any = { key: { fromMe: true }, message: { reactionMessage: {} } };
    expect(classifyFromMe(msg)).toEqual({ kind: 'ignore', reason: 'reaction' });
  });

  it('returns ignore for protocol', () => {
    const msg: any = { key: { fromMe: true }, message: { protocolMessage: {} } };
    expect(classifyFromMe(msg)).toEqual({ kind: 'ignore', reason: 'protocol' });
  });

  it('returns ignore for receipt', () => {
    const msg: any = { key: { fromMe: true }, message: { receiptMessage: {} } };
    expect(classifyFromMe(msg)).toEqual({ kind: 'ignore', reason: 'receipt' });
  });

  it('returns ignore for empty/missing message body', () => {
    const msg: any = { key: { fromMe: true }, message: null };
    expect(classifyFromMe(msg)).toEqual({ kind: 'ignore', reason: 'empty' });
  });

  it('returns ignore for ephemeral typing/state with no content', () => {
    const msg: any = { key: { fromMe: true }, message: {} };
    expect(classifyFromMe(msg)).toEqual({ kind: 'ignore', reason: 'typing' });
  });

  it('returns operator_outbound for plain text', () => {
    const msg: any = {
      key: { fromMe: true, id: 'X', remoteJid: '37120@s.whatsapp.net' },
      message: { conversation: 'hey' },
      messageTimestamp: 12345,
    };
    expect(classifyFromMe(msg)).toEqual({
      kind: 'operator_outbound',
      textPreview: 'hey',
      hasMedia: false,
      messageId: 'X',
      timestamp: 12345,
    });
  });

  it('returns operator_outbound for extendedTextMessage', () => {
    const msg: any = {
      key: { fromMe: true, id: 'X2', remoteJid: 'g@g.us' },
      message: { extendedTextMessage: { text: 'hello again' } },
      messageTimestamp: 7,
    };
    expect(classifyFromMe(msg)).toMatchObject({
      kind: 'operator_outbound',
      textPreview: 'hello again',
      hasMedia: false,
      messageId: 'X2',
      timestamp: 7,
    });
  });

  it('flags media on imageMessage and uses caption as preview', () => {
    const msg: any = {
      key: { fromMe: true, id: 'X', remoteJid: 'g@g.us' },
      message: { imageMessage: { caption: 'a' } },
      messageTimestamp: 1,
    };
    expect(classifyFromMe(msg)).toMatchObject({
      kind: 'operator_outbound',
      hasMedia: true,
      textPreview: 'a',
    });
  });

  it('flags media on documentMessage with empty caption', () => {
    const msg: any = {
      key: { fromMe: true, id: 'X', remoteJid: 'g@g.us' },
      message: { documentMessage: { mimetype: 'application/pdf' } },
      messageTimestamp: 1,
    };
    const r = classifyFromMe(msg);
    expect(r).toMatchObject({ kind: 'operator_outbound', hasMedia: true, textPreview: '' });
  });

  it('truncates very long text previews', () => {
    const long = 'x'.repeat(500);
    const msg: any = {
      key: { fromMe: true, id: 'X', remoteJid: 'r' },
      message: { conversation: long },
      messageTimestamp: 1,
    };
    const r = classifyFromMe(msg);
    if (r.kind !== 'operator_outbound') throw new Error('expected operator_outbound');
    expect(r.textPreview.length).toBe(200);
  });

  it('normalizes Baileys Long-typed messageTimestamp via toNumber()', () => {
    const msg: any = {
      key: { fromMe: true, id: 'X', remoteJid: 'r' },
      message: { conversation: 'hi' },
      messageTimestamp: { toNumber: () => 9999 },
    };
    const r = classifyFromMe(msg);
    if (r.kind !== 'operator_outbound') throw new Error('expected operator_outbound');
    expect(r.timestamp).toBe(9999);
  });

  it('returns empty messageId when key.id missing', () => {
    const msg: any = {
      key: { fromMe: true, remoteJid: 'r' },
      message: { conversation: 'hi' },
      messageTimestamp: 1,
    };
    const r = classifyFromMe(msg);
    if (r.kind !== 'operator_outbound') throw new Error('expected operator_outbound');
    expect(r.messageId).toBe('');
  });
});
