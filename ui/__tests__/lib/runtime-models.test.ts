import { describe, expect, it } from 'vitest';
import {
  STATIC_RUNTIME_MODEL_OPTIONS,
  withCurrentRuntimeModelOption,
} from '@/lib/runtime-models';

describe('runtime model options', () => {
  it('include non-Claude provider/model ids for runtime selectors', () => {
    expect(STATIC_RUNTIME_MODEL_OPTIONS.map((option) => option.id)).toContain('openai/gpt-5-mini');
  });

  it('preserves an unknown current model as a selectable option', () => {
    const options = withCurrentRuntimeModelOption(STATIC_RUNTIME_MODEL_OPTIONS, 'local/custom-model');
    expect(options.at(-1)).toMatchObject({
      id: 'local/custom-model',
      source: 'current',
    });
  });
});
