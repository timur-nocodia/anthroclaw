import { z } from 'zod';

const OperatorIdSchema = z.string().min(1);
const RouteIdSchema = z.string().min(1);

const OperatorSchema = z.object({
  id: OperatorIdSchema,
  commandRoutes: z.array(RouteIdSchema).default(['cli:local']),
  approvalRoutes: z.array(RouteIdSchema).default(['cli:local']),
});

export const BuildroomConfigSchema = z.object({
  schemaVersion: z.literal('auto-buildroom/v1'),
  roomId: z.string().min(1),
  mode: z.enum(['off', 'observe_only', 'manual_approval']),
  paused: z.boolean().default(false),
  killSwitchActive: z.boolean(),
  operators: z.array(OperatorSchema),
  watch: z.object({
    repo: z.object({ enabled: z.boolean() }),
    docs: z.object({ enabled: z.boolean() }),
    tests: z.object({ enabled: z.boolean() }),
    sessions: z.object({ enabled: z.boolean() }),
    rawTranscripts: z.object({ enabled: z.boolean() }),
    external: z.object({ enabled: z.boolean() }),
  }),
  paths: z.object({
    allowed: z.array(z.string()),
    blocked: z.array(z.string()),
  }),
  execution: z.object({
    mutationTarget: z.enum(['worktree', 'sandbox', 'in_place']),
    allowInPlaceDocsTests: z.boolean(),
    requireApprovalForBuild: z.boolean(),
    consumeApprovalOnBuildStart: z.boolean(),
    retryRequiresOperatorCommand: z.boolean(),
  }),
  external: z.object({
    readOnlyResearch: z.object({ enabled: z.boolean() }),
    sideEffects: z.object({ default: z.literal('deny') }),
  }),
  budgets: z.object({
    maxIdeasPerDay: z.number().int().positive(),
    maxBuildsPerDay: z.number().int().positive(),
    maxActiveBuilds: z.number().int().positive(),
    maxRuntimeMinutesPerStage: z.number().int().positive(),
  }),
}).superRefine((config, ctx) => {
  if (config.mode === 'manual_approval' && config.operators.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['operators'],
      message: 'manual_approval requires at least one operator',
    });
  }

  for (const [index, operator] of config.operators.entries()) {
    if (operator.id.startsWith('telegram_chat:') || operator.id.startsWith('telegram_thread:')) {
      ctx.addIssue({
        code: 'custom',
        path: ['operators', index, 'id'],
        message: 'Telegram chat/thread route is not operator identity',
      });
    }
  }

  const buildCapable = config.mode === 'manual_approval' && config.execution.requireApprovalForBuild;
  if (buildCapable && config.paths.allowed.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['paths', 'allowed'],
      message: 'build-capable room requires at least one allowed path',
    });
  }
});

export type BuildroomConfig = z.infer<typeof BuildroomConfigSchema>;

export interface BuildroomConfigIssue {
  path: Array<string | number>;
  message: string;
}

export type BuildroomConfigValidationResult =
  | { success: true; data: BuildroomConfig; issues: [] }
  | { success: false; issues: BuildroomConfigIssue[] };

export interface DefaultBuildroomConfigOptions {
  roomId: string;
  operatorId: string;
}

export function createDefaultBuildroomConfig(opts: DefaultBuildroomConfigOptions): BuildroomConfig {
  return {
    schemaVersion: 'auto-buildroom/v1',
    roomId: opts.roomId,
    mode: 'manual_approval',
    paused: false,
    killSwitchActive: false,
    operators: [
      {
        id: opts.operatorId,
        commandRoutes: ['cli:local'],
        approvalRoutes: ['cli:local'],
      },
    ],
    watch: {
      repo: { enabled: true },
      docs: { enabled: true },
      tests: { enabled: true },
      sessions: { enabled: false },
      rawTranscripts: { enabled: false },
      external: { enabled: false },
    },
    paths: {
      allowed: [
        'docs/Auto-Buildroom/examples/**',
        'tests/fixtures/auto-buildroom/**',
      ],
      blocked: [
        '.env',
        '.env.*',
        'config.yml',
        'config.yaml',
        'agents/**',
        'data/**',
        '.anthroclaw/auto-buildroom/**/buildroom.yml',
      ],
    },
    execution: {
      mutationTarget: 'worktree',
      allowInPlaceDocsTests: false,
      requireApprovalForBuild: true,
      consumeApprovalOnBuildStart: true,
      retryRequiresOperatorCommand: true,
    },
    external: {
      readOnlyResearch: { enabled: false },
      sideEffects: { default: 'deny' },
    },
    budgets: {
      maxIdeasPerDay: 5,
      maxBuildsPerDay: 1,
      maxActiveBuilds: 1,
      maxRuntimeMinutesPerStage: 20,
    },
  };
}

export function validateBuildroomConfig(config: unknown): BuildroomConfigValidationResult {
  const parsed = BuildroomConfigSchema.safeParse(config);
  if (parsed.success) return { success: true, data: parsed.data, issues: [] };
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part)),
      message: issue.message,
    })),
  };
}

export class BuildroomConfigValidationError extends Error {
  constructor(public readonly issues: BuildroomConfigIssue[]) {
    super(issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    this.name = 'BuildroomConfigValidationError';
  }
}

export function assertValidBuildroomConfig(config: unknown): BuildroomConfig {
  const result = validateBuildroomConfig(config);
  if (result.success) return result.data;
  throw new BuildroomConfigValidationError(result.issues);
}
