import { logger } from '../logger.js';

const MAX_INPUT_LENGTH = 500;
const MAX_TITLE_LENGTH = 80;
const FALLBACK_TITLE = 'Untitled Session';

export async function generateSessionTitle(
  userMessage: string,
  assistantResponse: string,
  queryFn: (prompt: string) => Promise<string>,
): Promise<string> {
  const truncatedUser = userMessage.slice(0, MAX_INPUT_LENGTH);
  const truncatedAssistant = assistantResponse.slice(0, MAX_INPUT_LENGTH);

  const prompt = [
    'Generate a short, descriptive title (3-7 words) for a conversation that starts with the following exchange.',
    'Return ONLY the title text, nothing else. No quotes, no punctuation, no prefixes like \'Title:\'.',
    `User: ${truncatedUser}`,
    `Assistant: ${truncatedAssistant}`,
  ].join(' ');

  let raw: string;
  try {
    raw = await queryFn(prompt);
  } catch (err) {
    logger.warn({ err }, 'Title generation failed, using fallback');
    return FALLBACK_TITLE;
  }

  let title = raw.trim();

  // Strip "Title:" prefix (case-insensitive)
  title = title.replace(/^title:\s*/i, '');

  // Strip surrounding quotes (single or double)
  title = title.replace(/^["']+|["']+$/g, '');

  // Strip trailing punctuation
  title = title.replace(/[.!?]+$/, '');

  // Final trim
  title = title.trim();

  if (!title) return FALLBACK_TITLE;

  // Enforce max length
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH - 3) + '...';
  }

  return title;
}
