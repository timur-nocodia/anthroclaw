import type { InlineButton } from '../channels/types.js';
import { formatDecisionCallbackData } from './events.js';
import type { DecisionRecord } from './types.js';

export interface DecisionRenderCapabilities {
  callbacks: boolean;
}

export interface RenderedDecisionPrompt {
  text: string;
  buttons?: InlineButton[][];
}

export function renderDecisionPrompt(
  decision: DecisionRecord,
  capabilities: DecisionRenderCapabilities,
): RenderedDecisionPrompt {
  const lines = [
    `Learning proposal ${decision.shortCode}`,
    '',
    decision.subject,
    decision.body ? `\n${decision.body}` : '',
  ].filter((line) => line !== '');

  if (capabilities.callbacks) {
    return {
      text: lines.join('\n'),
      buttons: [[
        { text: 'Save', callbackData: formatDecisionCallbackData(decision.shortCode, 'approve') },
        { text: 'Skip', callbackData: formatDecisionCallbackData(decision.shortCode, 'reject') },
        { text: 'Edit', callbackData: formatDecisionCallbackData(decision.shortCode, 'edit') },
      ]],
    };
  }

  return {
    text: [
      ...lines,
      '',
      'Reply 1 to save, 2 to skip, or 3 to edit.',
      `Commands: /learn approve ${decision.shortCode}, /learn reject ${decision.shortCode}, /learn edit ${decision.shortCode}`,
    ].join('\n'),
  };
}
