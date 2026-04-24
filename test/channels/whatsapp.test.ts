import { describe, it, expect } from 'vitest';
import { WhatsAppChannel, toWhatsAppJid } from '../../src/channels/whatsapp.js';
import { chunkText } from '../../src/channels/utils.js';

describe('WhatsAppChannel', () => {
  it('has correct id', () => {
    const ch = new WhatsAppChannel({
      accounts: { default: { auth_dir: '/tmp/wa-test-auth' } },
      mediaDir: '/tmp/wa-test-media',
    });
    expect(ch.id).toBe('whatsapp');
  });

  it('has editText as a no-op method', () => {
    expect(typeof WhatsAppChannel.prototype.editText).toBe('function');
  });
});

describe('chunkText', () => {
  it('returns single chunk when text is under limit', () => {
    const text = 'Hello, world!';
    const chunks = chunkText(text, 4000);
    expect(chunks).toEqual([text]);
  });

  it('splits at newline when text exceeds limit', () => {
    const line1 = 'A'.repeat(30);
    const line2 = 'B'.repeat(30);
    const text = `${line1}\n${line2}`;
    // Use a limit that forces a split between the two lines
    const chunks = chunkText(text, 35);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(`${line1}\n`);
    expect(chunks[1]).toBe(line2);
  });

  it('hard-splits when no newline is available', () => {
    const text = 'A'.repeat(100);
    const chunks = chunkText(text, 40);
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe('A'.repeat(40));
    expect(chunks[1]).toBe('A'.repeat(40));
    expect(chunks[2]).toBe('A'.repeat(20));
  });
});

describe('toWhatsAppJid', () => {
  it('adds @s.whatsapp.net to a plain number', () => {
    expect(toWhatsAppJid('1234567890')).toBe('1234567890@s.whatsapp.net');
  });

  it('leaves a JID with @ unchanged', () => {
    expect(toWhatsAppJid('1234567890@s.whatsapp.net')).toBe('1234567890@s.whatsapp.net');
  });

  it('handles group JID (already has @g.us)', () => {
    expect(toWhatsAppJid('120363123456789@g.us')).toBe('120363123456789@g.us');
  });
});
