export interface RuntimeModelOption {
  id: string;
  label: string;
  provider: string;
  runtime: 'pi' | 'opencode' | 'legacy-claude';
  source: 'static' | 'configured' | 'current';
  compatibility?: boolean;
}

export const LEGACY_CLAUDE_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
  'claude-opus-4-7',
] as const;

export const STATIC_RUNTIME_MODEL_OPTIONS: RuntimeModelOption[] = [
  modelOption('anthropic/claude-sonnet-4-6', 'anthropic', 'pi'),
  modelOption('anthropic/claude-opus-4-6', 'anthropic', 'pi'),
  modelOption('anthropic/claude-haiku-4-5', 'anthropic', 'pi'),
  modelOption('openai/gpt-5-mini', 'openai', 'pi'),
  ...LEGACY_CLAUDE_MODELS.map((id) => modelOption(id, 'anthropic', 'legacy-claude', true)),
];

export function withCurrentRuntimeModelOption(
  options: RuntimeModelOption[],
  current: string | undefined,
): RuntimeModelOption[] {
  if (!current || options.some((option) => option.id === current)) return options;
  return [
    ...options,
    {
      id: current,
      label: `${current} (current)`,
      provider: inferProvider(current),
      runtime: 'pi',
      source: 'current',
    },
  ];
}

export function modelOption(
  id: string,
  provider = inferProvider(id),
  runtime: RuntimeModelOption['runtime'] = 'pi',
  compatibility = false,
  source: RuntimeModelOption['source'] = 'static',
  label = id,
): RuntimeModelOption {
  return {
    id,
    label,
    provider,
    runtime,
    source,
    ...(compatibility ? { compatibility: true } : {}),
  };
}

function inferProvider(id: string): string {
  const separator = id.includes('/') ? '/' : id.includes(':') ? ':' : null;
  if (separator) return id.slice(0, id.indexOf(separator));
  if (id.startsWith('claude-')) return 'anthropic';
  return 'custom';
}
