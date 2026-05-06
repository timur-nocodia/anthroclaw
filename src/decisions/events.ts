import type { DecisionSelection } from './types.js';

const SHORT_CODE_PATTERN = '[A-Za-z0-9_-]{3,64}';

export interface ParsedDecisionReference {
  shortCode: string;
  selected: DecisionSelection;
}

export function parseDecisionCallbackData(data: string): ParsedDecisionReference | null {
  const match = new RegExp(`^decision:(${SHORT_CODE_PATTERN}):(approve|reject|edit|undo)$`, 'i').exec(data.trim());
  if (!match) return null;
  return {
    shortCode: normalizeShortCode(match[1]),
    selected: normalizeSelection(match[2]) as DecisionSelection,
  };
}

export function parseDecisionTextCommand(text: string): ParsedDecisionReference | null {
  const match = new RegExp(`^/learn(?:@\\S+)?\\s+(approve|allow|yes|save|reject|deny|no|skip|edit|change|undo)\\s+(${SHORT_CODE_PATTERN})\\s*$`, 'i')
    .exec(text.trim());
  if (!match) return null;
  const selected = normalizeSelection(match[1]);
  if (!selected) return null;
  return {
    shortCode: normalizeShortCode(match[2]),
    selected,
  };
}

export function parseBareDecisionReply(text: string): DecisionSelection | null {
  return normalizeSelection(text.trim());
}

export function formatDecisionCallbackData(shortCode: string, selected: DecisionSelection): string {
  return `decision:${normalizeShortCode(shortCode)}:${selected}`;
}

function normalizeShortCode(shortCode: string): string {
  return shortCode.trim().toUpperCase();
}

function normalizeSelection(raw: string): DecisionSelection | null {
  const value = raw.trim().toLowerCase();
  if (['1', 'approve', 'allow', 'yes', 'y', 'save', 'да', 'сохранить'].includes(value)) return 'approve';
  if (['2', 'reject', 'deny', 'no', 'n', 'skip', 'нет'].includes(value)) return 'reject';
  if (['3', 'edit', 'change', 'изменить'].includes(value)) return 'edit';
  if (['undo', 'rollback'].includes(value)) return 'undo';
  return null;
}
