import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import type { OutboundMedia } from './types.js';

export type ResponseArtifactDeliveryReason = 'html_path' | 'html_content';

export interface ResponseArtifactDeliveryPlan {
  media: OutboundMedia;
  suppressText: boolean;
  reason: ResponseArtifactDeliveryReason;
}

const HTML_PATH_RE = /(?:^|[\s"'`(])((?:\.{1,2}\/|\/)?(?:[^\s"'`<>|?*]+\/)*[^\s"'`<>|?*]+\.html?)\b/gi;
const HTML_FENCE_RE = /```(?:html)?[^\n]*\n([\s\S]*?)```/gi;
const HTML_DOCUMENT_RE = /(?:<!doctype\s+html[\s\S]*?<\/html>|<html\b[\s\S]*?<\/html>)/i;

export function planResponseArtifactDelivery(
  response: string,
  workspacePath: string,
): ResponseArtifactDeliveryPlan | null {
  const pathPlan = planHtmlPathArtifact(response, workspacePath);
  if (pathPlan) return pathPlan;

  const html = extractHtmlDocument(response);
  if (!html) return null;

  const fileName = 'agent-response.html';
  return {
    media: {
      type: 'document',
      buffer: Buffer.from(html, 'utf8'),
      mimeType: 'text/html',
      fileName,
      caption: captionFor(fileName),
    },
    suppressText: true,
    reason: 'html_content',
  };
}

function planHtmlPathArtifact(
  response: string,
  workspacePath: string,
): ResponseArtifactDeliveryPlan | null {
  for (const match of response.matchAll(HTML_PATH_RE)) {
    const candidate = match[1];
    if (!candidate) continue;

    const resolvedPath = resolveExistingWorkspaceFile(workspacePath, candidate);
    if (!resolvedPath) continue;

    const fileName = basename(resolvedPath);
    return {
      media: {
        type: 'document',
        path: resolvedPath,
        mimeType: 'text/html',
        fileName,
        caption: captionFor(fileName),
      },
      suppressText: true,
      reason: 'html_path',
    };
  }

  return null;
}

function resolveExistingWorkspaceFile(workspacePath: string, candidate: string): string | null {
  const workspace = resolve(workspacePath);
  const resolvedPath = resolve(workspace, candidate);

  if (!isInsidePath(resolvedPath, workspace)) return null;
  if (!existsSync(resolvedPath)) return null;

  try {
    const stat = statSync(resolvedPath);
    if (!stat.isFile()) return null;

    const realWorkspace = realpathSync.native(workspace);
    const realFile = realpathSync.native(resolvedPath);
    if (!isInsidePath(realFile, realWorkspace)) return null;

    return realFile;
  } catch {
    return null;
  }
}

function isInsidePath(target: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(normalizedRoot);
}

function extractHtmlDocument(response: string): string | null {
  for (const match of response.matchAll(HTML_FENCE_RE)) {
    const fenced = match[1]?.trim();
    if (!fenced) continue;
    const document = fenced.match(HTML_DOCUMENT_RE)?.[0]?.trim();
    if (document) return document;
  }

  return response.match(HTML_DOCUMENT_RE)?.[0]?.trim() ?? null;
}

function captionFor(fileName: string): string {
  return `HTML preview: ${fileName}`;
}
