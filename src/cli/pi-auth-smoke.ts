import 'dotenv/config';
import { DEFAULT_PI_MODEL_ID, parsePiModelRef } from '../runtime/pi-headless.js';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';

interface PiAuthSmokeArgs {
  model: string;
  authPath?: string;
  modelsPath?: string;
  allowSkip: boolean;
  json: boolean;
  help: boolean;
}

interface PiAuthSmokeDeps {
  loadSdk?: () => Promise<PiAuthSdkModule>;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}

interface PiAuthSdkModule {
  AuthStorage: {
    create: (authPath?: string) => PiAuthStorageLike;
  };
  ModelRegistry: {
    create: (authStorage: PiAuthStorageLike, modelsPath?: string) => PiModelRegistryLike;
  };
  VERSION?: string;
}

interface PiAuthStorageLike {}

interface PiModelRegistryLike {
  find(provider: string, modelId: string): PiModelLike | undefined;
  getAvailable(): Promise<PiModelLike[]>;
  hasConfiguredAuth(provider: string): boolean | Promise<boolean>;
  getProviderAuthStatus?(provider: string): unknown | Promise<unknown>;
}

interface PiModelLike {
  provider?: unknown;
  id?: unknown;
  name?: unknown;
}

interface PiAuthSmokeResult {
  status: 'passed' | 'failed' | 'skipped';
  runtime: 'pi';
  package: {
    name: string;
    version?: string;
    importable: boolean;
  };
  model: {
    requested: string;
    provider: string;
    id: string;
    found: boolean;
    available: boolean;
    name?: string;
  };
  auth: {
    provider: string;
    configured: boolean;
    status?: Record<string, unknown>;
  };
  availableModelCount: number;
  error?: string;
  nextAction?: string;
}

export async function runPiAuthSmokeCli(
  argv: string[],
  deps: PiAuthSmokeDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  let args: PiAuthSmokeArgs;

  try {
    args = parsePiAuthSmokeArgs(argv);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    stderr.write(`${usage()}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  const ref = parsePiModelRef(args.model);
  try {
    const sdk = await (deps.loadSdk ?? loadPiSdk)();
    const result = await runPiAuthSmoke(args.model, ref, sdk, {
      authPath: args.authPath,
      modelsPath: args.modelsPath,
    });
    const normalized = args.allowSkip && result.status === 'failed' && isSkippablePiSetupError(result.error ?? '')
      ? { ...result, status: 'skipped' as const }
      : result;
    writeResult(normalized.status === 'failed' ? stderr : stdout, args.json, normalized);
    return normalized.status === 'failed' ? 1 : 0;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const status = args.allowSkip && isSkippablePiSetupError(error) ? 'skipped' : 'failed';
    const result: PiAuthSmokeResult = {
      status,
      runtime: 'pi',
      package: {
        name: PI_PACKAGE_NAME,
        importable: false,
      },
      model: {
        requested: args.model,
        provider: ref.provider,
        id: ref.modelId,
        found: false,
        available: false,
      },
      auth: {
        provider: ref.provider,
        configured: false,
      },
      availableModelCount: 0,
      error,
      nextAction: setupNextAction(ref.provider, args.model),
    };
    writeResult(status === 'failed' ? stderr : stdout, args.json, result);
    return status === 'skipped' ? 0 : 1;
  }
}

export async function runPiAuthSmoke(
  requestedModel: string,
  ref = parsePiModelRef(requestedModel),
  sdk: PiAuthSdkModule,
  options: { authPath?: string; modelsPath?: string } = {},
): Promise<PiAuthSmokeResult> {
  const authStorage = sdk.AuthStorage.create(options.authPath);
  const modelRegistry = sdk.ModelRegistry.create(authStorage, options.modelsPath);
  const model = modelRegistry.find(ref.provider, ref.modelId);
  const available = await modelRegistry.getAvailable();
  const providerAuthConfigured = await modelRegistry.hasConfiguredAuth(ref.provider);
  const providerStatus = await modelRegistry.getProviderAuthStatus?.(ref.provider);
  const modelAvailable = available.some((candidate) =>
    candidate.provider === ref.provider && candidate.id === ref.modelId);

  const base: PiAuthSmokeResult = {
    status: 'passed',
    runtime: 'pi',
    package: {
      name: PI_PACKAGE_NAME,
      version: sdk.VERSION,
      importable: true,
    },
    model: {
      requested: requestedModel,
      provider: ref.provider,
      id: ref.modelId,
      found: Boolean(model),
      available: modelAvailable,
      name: typeof model?.name === 'string' ? model.name : undefined,
    },
    auth: {
      provider: ref.provider,
      configured: Boolean(providerAuthConfigured),
      status: sanitizeProviderStatus(providerStatus),
    },
    availableModelCount: available.length,
  };

  if (!model) {
    return {
      ...base,
      status: 'failed',
      error: `Pi model registry could not find model ${ref.provider}/${ref.modelId}.`,
      nextAction: 'Run `pnpm smoke:pi-auth -- --model <provider/model> --json` with a Pi model id from `pi --list-models`.',
    };
  }

  if (!providerAuthConfigured) {
    return {
      ...base,
      status: 'failed',
      error: `Pi provider ${ref.provider} has no configured credentials.`,
      nextAction: setupNextAction(ref.provider, requestedModel),
    };
  }

  if (!modelAvailable) {
    return {
      ...base,
      status: 'failed',
      error: `Pi model ${ref.provider}/${ref.modelId} exists but is not available with the configured credentials.`,
      nextAction: `Authenticate a provider that exposes ${requestedModel}, or choose another available model with --model.`,
    };
  }

  return base;
}

export function parsePiAuthSmokeArgs(argv: string[]): PiAuthSmokeArgs {
  const args: PiAuthSmokeArgs = {
    model: DEFAULT_PI_MODEL_ID,
    allowSkip: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--':
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--model':
        args.model = requireValue(argv, ++i, '--model');
        break;
      case '--auth-path':
        args.authPath = requireValue(argv, ++i, '--auth-path');
        break;
      case '--models-path':
        args.modelsPath = requireValue(argv, ++i, '--models-path');
        break;
      case '--allow-skip':
        args.allowSkip = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function loadPiSdk(): Promise<PiAuthSdkModule> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PiAuthSdkModule>;
  try {
    return await dynamicImport(PI_PACKAGE_NAME);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Pi auth smoke requires optional package ${PI_PACKAGE_NAME}. Original error: ${message}`);
  }
}

function sanitizeProviderStatus(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['configured', 'type', 'provider', 'error']) {
    const current = source[key];
    if (typeof current === 'string' || typeof current === 'boolean' || typeof current === 'number') {
      result[key] = current;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function setupNextAction(provider: string, model: string): string {
  return [
    `Configure Pi credentials for provider ${provider}.`,
    'Use interactive `pi` and run `/login`, or set the provider API key environment variable documented by Pi.',
    `Then rerun \`pnpm smoke:pi-auth -- --model ${model} --json\`.`,
  ].join(' ');
}

function writeResult(
  stream: Pick<NodeJS.WriteStream, 'write'>,
  json: boolean,
  result: PiAuthSmokeResult,
): void {
  if (json) {
    stream.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (result.status === 'passed') {
    stream.write([
      'Pi auth smoke passed.',
      `package: ${result.package.name}${result.package.version ? `@${result.package.version}` : ''}`,
      `model: ${result.model.provider}/${result.model.id}`,
      `available models: ${result.availableModelCount}`,
    ].join('\n'));
    stream.write('\n');
    return;
  }

  stream.write(`Pi auth smoke ${result.status}: ${result.error ?? 'unknown error'}\n`);
  if (result.nextAction) {
    stream.write(`Next: ${result.nextAction}\n`);
  }
}

function isSkippablePiSetupError(message: string): boolean {
  return /@earendil-works\/pi-coding-agent|optional package|api key|auth|oauth|credential|provider|model registry/i
    .test(message);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function usage(): string {
  return [
    'Usage: pnpm smoke:pi-auth -- [--json] [--allow-skip] [--model <provider/model>]',
    '',
    'Options:',
    `  --model <provider/model>  Pi model to validate (default: ${DEFAULT_PI_MODEL_ID})`,
    '  --auth-path <path>        optional Pi auth.json path',
    '  --models-path <path>      optional Pi models.json path',
    '  --allow-skip              exit 0 for missing optional Pi runtime/auth setup',
    '  --json                    print structured smoke result',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPiAuthSmokeCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
