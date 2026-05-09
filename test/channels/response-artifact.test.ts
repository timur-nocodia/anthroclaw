import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planResponseArtifactDelivery } from '../../src/channels/response-artifact.js';

describe('planResponseArtifactDelivery', () => {
  it('plans an existing workspace HTML path as a document attachment', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'anthroclaw-artifact-'));
    mkdirSync(join(workspace, 'output', 'carousels'), { recursive: true });
    const htmlPath = join(workspace, 'output', 'carousels', 'carousel.html');
    writeFileSync(htmlPath, '<!doctype html><html><body>slides</body></html>');

    const plan = planResponseArtifactDelivery(
      'Готово: output/carousels/carousel.html. Открой в Telegram для просмотра.',
      workspace,
    );

    expect(plan).toEqual({
      media: {
        type: 'document',
        path: realpathSync.native(htmlPath),
        mimeType: 'text/html',
        fileName: 'carousel.html',
        caption: 'HTML preview: carousel.html',
      },
      suppressText: true,
      reason: 'html_path',
    });
  });

  it('plans a full HTML code fence as a document buffer instead of chat text', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'anthroclaw-artifact-'));
    const response = [
      'Готово, вот HTML:',
      '```html',
      '<!doctype html>',
      '<html><head><title>Deck</title></head><body><deck-stage>slides</deck-stage></body></html>',
      '```',
    ].join('\n');

    const plan = planResponseArtifactDelivery(response, workspace);

    expect(plan?.reason).toBe('html_content');
    expect(plan?.suppressText).toBe(true);
    expect(plan?.media).toMatchObject({
      type: 'document',
      mimeType: 'text/html',
      fileName: 'agent-response.html',
      caption: 'HTML preview: agent-response.html',
    });
    expect(plan?.media.buffer?.toString('utf8')).toContain('<deck-stage>slides</deck-stage>');
    expect(plan?.media.buffer?.toString('utf8')).not.toContain('```');
  });

  it('ignores HTML paths outside the workspace', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'anthroclaw-artifact-'));

    expect(planResponseArtifactDelivery('Готово: /etc/passwd.html', workspace)).toBeNull();
    expect(planResponseArtifactDelivery('Готово: ../outside.html', workspace)).toBeNull();
  });
});
