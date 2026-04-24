export function chunkText(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) { chunks.push(remaining); break; }
    const nlIdx = remaining.lastIndexOf('\n', limit);
    const splitAt = nlIdx > limit / 2 ? nlIdx + 1 : limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'video/mp4': '.mp4', 'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'application/pdf': '.pdf',
  'application/zip': '.zip',
};

export function mimeToExtension(mime: string): string {
  return MIME_TO_EXT[mime] ?? '';
}

export function markdownToTelegramHtml(text: string): string {
  // Escape HTML entities first (but preserve existing HTML tags)
  let result = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks: ```lang\n...\n``` → <pre>...</pre>
  result = result.replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code) =>
    `<pre>${code.trimEnd()}</pre>`);

  // Inline code: `...` → <code>...</code>
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold: **text** → <b>text</b>
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Italic: *text* or _text_ → <i>text</i> (but not inside words like file_name)
  result = result.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
  result = result.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');

  // Strikethrough: ~~text~~ → <s>text</s>
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Links: [text](url) → <a href="url">text</a>
  result = result.replace(/\[([^\]]+)]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return result;
}
