"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Brain,
  ChevronLeft,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Download,
  DollarSign,
  FileText,
  GitBranch,
  Globe,
  HelpCircle,
  Key,
  List,
  MessageSquare,
  Monitor,
  Plus,
  Plug,
  RefreshCw,
  Save,
  Settings2,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  XCircle,
  Zap,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentConfig {
  id: string;
  model?: string;
  thinking?: { type: string; budgetTokens?: number };
  effort?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  description?: string;
  timezone?: string;
  queue_mode?: string;
  session_policy?: string;
  auto_compress?: number;
  iteration_budget?: {
    tool_call_limit?: number;
    max_tool_calls?: number;
    timeout_ms?: number;
    absolute_timeout_ms?: number;
  };
  pairing?: { mode?: string; code?: string };
  routes?: Array<{
    channel: string;
    account: string;
    scope: string;
    peers?: string[] | null;
    topics?: string[] | null;
    mentionOnly?: boolean;
  }>;
  raw?: string;
  channel_context?: ChannelContextConfig;
  mcp_tools?: string[];
  memory_extraction?: {
    enabled?: boolean;
    max_candidates?: number;
    max_input_chars?: number;
  };
  external_mcp_servers?: Record<string, ExternalMcpServerConfig>;
  allowlist?: Record<string, string[]>;
  quick_commands?: Record<string, { command: string; timeout: number }>;
  group_sessions?: string;
  display?: {
    toolProgress?: string;
    streaming?: boolean;
    toolPreviewLength?: number;
    showReasoning?: boolean;
  };
  hooks?: Array<{
    event: string;
    action: string;
    url?: string;
    command?: string;
    timeout_ms?: number;
  }>;
  cron?: Array<{
    id: string;
    schedule: string;
    prompt: string;
    deliver_to?: { channel: string; peer_id: string; account_id?: string };
    enabled: boolean;
  }>;
  maxSessions?: number;
  subagents?: {
    allow: string[];
    max_spawn_depth?: number;
    conflict_mode?: "soft" | "strict";
    roles?: Record<string, {
      kind?: "explorer" | "worker" | "custom";
      write_policy?: "allow" | "deny" | "claim_required";
      description?: string;
    }>;
  };
  sdk?: {
    allowedTools?: string[];
    disallowedTools?: string[];
    permissions?: {
      mode?: string;
      default_behavior?: string;
      allow_mcp?: boolean;
      allow_bash?: boolean;
      allow_web?: boolean;
      allowed_mcp_tools?: string[];
      denied_bash_patterns?: string[];
    };
    sandbox?: {
      enabled?: boolean;
      failIfUnavailable?: boolean;
      autoAllowBashIfSandboxed?: boolean;
      allowUnsandboxedCommands?: boolean;
      network?: {
        allowedDomains?: string[];
        deniedDomains?: string[];
        allowManagedDomainsOnly?: boolean;
        allowLocalBinding?: boolean;
      };
      filesystem?: {
        allowWrite?: string[];
        denyWrite?: string[];
        allowRead?: string[];
        denyRead?: string[];
        allowManagedReadPathsOnly?: boolean;
      };
    };
    promptSuggestions?: boolean;
    agentProgressSummaries?: boolean;
    includePartialMessages?: boolean;
    includeHookEvents?: boolean;
    enableFileCheckpointing?: boolean;
    fallbackModel?: string;
  };
}

type ReplyToMode = "always" | "incoming_reply_only" | "never";

interface ChannelBehaviorRule {
  prompt?: string;
  reply_to_mode?: ReplyToMode;
}

interface ChannelContextConfig {
  reply_to_mode?: ReplyToMode;
  telegram?: {
    wildcard?: ChannelBehaviorRule;
    peers?: Record<string, ChannelBehaviorRule>;
    topics?: Record<string, ChannelBehaviorRule>;
  };
  whatsapp?: {
    wildcard?: ChannelBehaviorRule;
    direct?: Record<string, ChannelBehaviorRule>;
    groups?: Record<string, ChannelBehaviorRule>;
  };
}

interface ExternalMcpServerConfig {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  allowed_tools?: string[];
}

interface ExternalMcpPreflightServer {
  serverName: string;
  approvalStatus: "approved" | "review_required" | "blocked";
  networkRisk: "low" | "medium" | "high";
  filesystemRisk: "low" | "medium" | "high";
  packageSource: string;
  reasons: string[];
}

interface ExternalMcpPreflightState {
  loading?: boolean;
  error?: string;
  server?: ExternalMcpPreflightServer;
}

const HOOK_EVENTS = [
  "on_message_received",
  "on_before_query",
  "on_after_query",
  "on_session_reset",
  "on_cron_fire",
  "on_memory_write",
  "on_tool_use",
  "on_tool_result",
  "on_tool_error",
  "on_permission_request",
  "on_elicitation",
  "on_elicitation_result",
  "on_sdk_notification",
  "on_subagent_start",
  "on_subagent_stop",
] as const;

interface AgentFile {
  name: string;
  size: number;
  updatedAt: string;
  special?: string;
}

interface SkillInfo {
  name: string;
  description: string;
  platforms: string[];
  tags: string[];
  attached?: boolean;
  catalog?: boolean;
}

type AgentRunStatus = "running" | "succeeded" | "failed" | "interrupted";

interface AgentRunRecord {
  runId: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  agentId: string;
  sessionKey: string;
  sdkSessionId?: string;
  source: "channel" | "web" | "cron";
  channel: string;
  accountId?: string;
  peerId?: string;
  threadId?: string;
  messageId?: string;
  routeDecisionId?: string;
  status: AgentRunStatus;
  model?: string;
  budget?: Record<string, unknown>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    totalCostUsd?: number;
    durationMs?: number;
    durationApiMs?: number;
    numTurns?: number;
  };
  error?: string;
}

interface RouteDecisionCandidate {
  agentId: string;
  channel: string;
  accountId: string;
  scope: string;
  peers?: string[];
  topics?: string[];
  mentionOnly: boolean;
  priority: number;
}

interface RouteDecisionRecord {
  id: string;
  timestamp?: number;
  messageId?: string;
  channel: string;
  accountId: string;
  chatType: string;
  peerId: string;
  senderId: string;
  threadId?: string;
  candidates: RouteDecisionCandidate[];
  winnerAgentId?: string;
  accessAllowed?: boolean;
  accessReason?: string;
  queueAction?: string;
  sessionKey?: string;
  outcome: string;
}

type MemoryReviewStatus = "pending" | "approved" | "rejected";

interface MemoryEntryRecord {
  id: string;
  path: string;
  contentHash: string;
  source: string;
  reviewStatus: MemoryReviewStatus;
  reviewNote?: string;
  provenance: {
    runId?: string;
    traceId?: string;
    sessionKey?: string;
    sdkSessionId?: string;
    toolName?: string;
    metadata?: Record<string, unknown>;
  };
  createdAt: number;
  updatedAt: number;
}

interface MemoryDoctorIssue {
  kind: "duplicate_content" | "stale_entry" | "oversized_file" | "conflicting_fact";
  severity: "info" | "warn" | "error";
  message: string;
  paths: string[];
  entryIds: string[];
  evidence?: Record<string, unknown>;
}

interface MemoryDoctorReport {
  checkedAt: number;
  entriesChecked: number;
  chunksChecked: number;
  issues: MemoryDoctorIssue[];
  summary: {
    duplicateContent: number;
    staleEntries: number;
    oversizedFiles: number;
    conflictingFacts: number;
  };
}

interface MemoryInfluenceRef {
  memoryEntryId?: string;
  path: string;
  startLine?: number;
  endLine?: number;
  score?: number;
}

interface MemoryInfluenceEvent {
  id?: number;
  timestamp?: number;
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  sdkSessionId?: string;
  source: "prefetch" | "memory_search";
  query?: string;
  refs: MemoryInfluenceRef[];
}

const MODELS = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
  "claude-opus-4-7",
];

const EFFORT_LEVELS = [
  { value: "low", label: "low — minimal thinking, fastest" },
  { value: "medium", label: "medium — moderate thinking" },
  { value: "high", label: "high — deep reasoning (default)" },
  { value: "xhigh", label: "xhigh — deeper (Opus 4.7 only)" },
  { value: "max", label: "max — maximum effort (select models)" },
];

const THINKING_MODES = [
  { value: "adaptive", label: "adaptive — model decides when to think" },
  { value: "enabled", label: "enabled — fixed budget" },
  { value: "disabled", label: "disabled — no extended thinking" },
];

const SDK_PERMISSION_MODES = [
  { value: "default", label: "default" },
  { value: "acceptEdits", label: "acceptEdits" },
  { value: "dontAsk", label: "dontAsk" },
];

function csvToArray(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function arrayToCsv(value?: string[]): string {
  return value?.join(", ") ?? "";
}

function mapToEnvText(value?: Record<string, string>): string {
  return Object.entries(value ?? {}).map(([key, entry]) => `${key}=${entry}`).join("\n");
}

function envTextToMap(value: string): Record<string, string> | undefined {
  const entries = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return index === -1
        ? [line, ""] as const
        : [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
    })
    .filter(([key]) => key.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

const TIMEZONES = [
  "UTC",
  "Europe/Moscow",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Asia/Tokyo",
];

const SCHEDULE_PRESETS = [
  { cron: "* * * * *", label: "Every minute" },
  { cron: "*/5 * * * *", label: "Every 5 minutes" },
  { cron: "*/15 * * * *", label: "Every 15 minutes" },
  { cron: "*/30 * * * *", label: "Every 30 minutes" },
  { cron: "0 * * * *", label: "Every hour" },
  { cron: "0 */2 * * *", label: "Every 2 hours" },
  { cron: "0 */6 * * *", label: "Every 6 hours" },
  { cron: "0 9 * * *", label: "Daily at 9:00" },
  { cron: "0 9 * * 1-5", label: "Weekdays at 9:00" },
  { cron: "0 21 * * *", label: "Daily at 21:00" },
  { cron: "0 0 * * *", label: "Daily at midnight" },
  { cron: "0 9 * * 1", label: "Every Monday at 9:00" },
  { cron: "0 9 1 * *", label: "1st of each month at 9:00" },
];

function describeCron(expr: string): string {
  const preset = SCHEDULE_PRESETS.find((p) => p.cron === expr);
  if (preset) return preset.label;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const pieces: string[] = [];
  if (min === "*" && hour === "*") pieces.push("every minute");
  else if (min.startsWith("*/")) pieces.push(`every ${min.slice(2)} min`);
  else if (hour === "*") pieces.push(`at :${min.padStart(2, "0")} every hour`);
  else if (hour.startsWith("*/")) pieces.push(`every ${hour.slice(2)}h at :${min.padStart(2, "0")}`);
  else pieces.push(`at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`);
  if (dow === "1-5") pieces.push("weekdays");
  else if (dow !== "*") pieces.push(`dow ${dow}`);
  if (dom !== "*") pieces.push(`day ${dom}`);
  if (mon !== "*") pieces.push(`month ${mon}`);
  return pieces.join(", ");
}

/* ------------------------------------------------------------------ */
/*  Agent Editor                                                       */
/* ------------------------------------------------------------------ */

export default function AgentEditorPage() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.serverId as string;
  const agentId = params.agentId as string;

  const [agent, setAgent] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("config");

  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents/${agentId}`);
      if (res.ok) {
        const d = await res.json();
        const config = d.parsed ?? d;
        setAgent({ id: agentId, raw: d.raw, ...config });
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [serverId, agentId]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2 text-[11.5px]">
            <Link
              href={`/fleet/${serverId}/agents`}
              className="flex items-center gap-1"
              style={{ color: "var(--oc-text-muted)" }}
            >
              <ChevronLeft className="h-3 w-3" />
              Agents
            </Link>
            <span style={{ color: "var(--oc-text-muted)" }}>/</span>
            <span style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
              {agentId}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold" style={{ color: "var(--color-foreground)" }}>
              {agentId}
            </h1>
            {agent && (
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
                  style={{
                    background: "var(--oc-accent-soft)",
                    border: "1px solid var(--oc-accent-ring)",
                    color: "var(--oc-accent)",
                  }}
                >
                  {agent.model ?? "---"}
                </span>
                <span
                  className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
                  style={{
                    background: "rgba(74,222,128,0.15)",
                    border: "1px solid rgba(74,222,128,0.35)",
                    color: "var(--oc-green)",
                  }}
                >
                  &#9679; loaded
                </span>
              </div>
            )}
          </div>
          {agent?.description && (
            <p className="text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
              {agent.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/fleet/${serverId}/chat/${agentId}`)}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Test in chat
          </Button>
          <Button variant="outline" size="sm" onClick={fetchAgent}>
            <RefreshCw className="h-3.5 w-3.5" />
            Reload
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList
          className="h-auto w-full justify-start rounded-none border-b px-5"
          style={{
            background: "var(--oc-bg0)",
            borderColor: "var(--oc-border)",
          }}
        >
          <TabsTrigger
            value="config"
            className="rounded-none border-b-2 px-3.5 py-2 text-[12.5px] data-[state=active]:border-[var(--oc-accent)] data-[state=active]:text-[var(--color-foreground)] data-[state=active]:shadow-none data-[state=inactive]:border-transparent"
          >
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Config
          </TabsTrigger>
          <TabsTrigger
            value="files"
            className="rounded-none border-b-2 px-3.5 py-2 text-[12.5px] data-[state=active]:border-[var(--oc-accent)] data-[state=active]:text-[var(--color-foreground)] data-[state=active]:shadow-none data-[state=inactive]:border-transparent"
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Files
          </TabsTrigger>
          <TabsTrigger
            value="runs"
            className="rounded-none border-b-2 px-3.5 py-2 text-[12.5px] data-[state=active]:border-[var(--oc-accent)] data-[state=active]:text-[var(--color-foreground)] data-[state=active]:shadow-none data-[state=inactive]:border-transparent"
          >
            <Clock className="mr-1.5 h-3.5 w-3.5" />
            Runs
          </TabsTrigger>
          <TabsTrigger
            value="memory"
            className="rounded-none border-b-2 px-3.5 py-2 text-[12.5px] data-[state=active]:border-[var(--oc-accent)] data-[state=active]:text-[var(--color-foreground)] data-[state=active]:shadow-none data-[state=inactive]:border-transparent"
          >
            <Database className="mr-1.5 h-3.5 w-3.5" />
            Memory
          </TabsTrigger>
          <TabsTrigger
            value="skills"
            className="rounded-none border-b-2 px-3.5 py-2 text-[12.5px] data-[state=active]:border-[var(--oc-accent)] data-[state=active]:text-[var(--color-foreground)] data-[state=active]:shadow-none data-[state=inactive]:border-transparent"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            Skills
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-0 flex-1 overflow-auto">
          {agent && <ConfigTab serverId={serverId} agentId={agentId} agent={agent} />}
        </TabsContent>
        <TabsContent value="files" className="mt-0 flex-1 overflow-hidden">
          <FilesTab serverId={serverId} agentId={agentId} />
        </TabsContent>
        <TabsContent value="runs" className="mt-0 flex-1 overflow-auto">
          <RunsTab serverId={serverId} agentId={agentId} />
        </TabsContent>
        <TabsContent value="memory" className="mt-0 flex-1 overflow-auto">
          <MemoryReviewTab serverId={serverId} agentId={agentId} />
        </TabsContent>
        <TabsContent value="skills" className="mt-0 flex-1 overflow-auto">
          <SkillsTab serverId={serverId} agentId={agentId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Config Tab                                                         */
/* ------------------------------------------------------------------ */

function ConfigTab({
  serverId,
  agentId,
  agent,
}: {
  serverId: string;
  agentId: string;
  agent: AgentConfig;
}) {
  const [mode, setMode] = useState<"form" | "raw">("form");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState({
    model: agent.model ?? "claude-sonnet-4-6",
    thinking: agent.thinking ?? { type: "adaptive" as string, budgetTokens: undefined as number | undefined },
    effort: agent.effort ?? "high",
    maxTurns: agent.maxTurns ?? 0,
    maxBudgetUsd: agent.maxBudgetUsd ?? 0,
    timezone: agent.timezone ?? "UTC",
    queue_mode: agent.queue_mode ?? "collect",
    session_policy: agent.session_policy ?? "daily",
    auto_compress: agent.auto_compress ?? 0,
    iteration_budget: {
      tool_call_limit: agent.iteration_budget?.tool_call_limit ?? agent.iteration_budget?.max_tool_calls ?? 20,
      timeout_ms: agent.iteration_budget?.timeout_ms ?? 120000,
      absolute_timeout_ms: agent.iteration_budget?.absolute_timeout_ms ?? 0,
    },
    pairing: {
      mode: agent.pairing?.mode ?? "open",
      code: agent.pairing?.code ?? "",
    },
    routes: agent.routes ?? [],
    channel_context: agent.channel_context ?? { reply_to_mode: "always" as ReplyToMode },
    mcp_tools: agent.mcp_tools ?? [],
    memory_extraction: {
      enabled: agent.memory_extraction?.enabled ?? false,
      max_candidates: agent.memory_extraction?.max_candidates ?? 5,
      max_input_chars: agent.memory_extraction?.max_input_chars ?? 6000,
    },
    external_mcp_servers: agent.external_mcp_servers ?? {},
    allowlist: agent.allowlist ?? {},
    quick_commands: agent.quick_commands ?? {},
    group_sessions: agent.group_sessions ?? 'shared',
    display: agent.display ?? {},
    hooks: agent.hooks ?? [],
    cron: agent.cron ?? [],
    maxSessions: agent.maxSessions ?? 100,
    subagents: {
      allow: agent.subagents?.allow ?? [],
      max_spawn_depth: agent.subagents?.max_spawn_depth ?? 1,
      conflict_mode: agent.subagents?.conflict_mode ?? "soft" as const,
      roles: agent.subagents?.roles ?? {},
    },
    sdk: {
      allowedTools: agent.sdk?.allowedTools ?? [],
      disallowedTools: agent.sdk?.disallowedTools ?? [],
      fallbackModel: agent.sdk?.fallbackModel ?? "",
      promptSuggestions: agent.sdk?.promptSuggestions ?? false,
      agentProgressSummaries: agent.sdk?.agentProgressSummaries ?? false,
      includePartialMessages: agent.sdk?.includePartialMessages ?? false,
      includeHookEvents: agent.sdk?.includeHookEvents ?? false,
      enableFileCheckpointing: agent.sdk?.enableFileCheckpointing ?? false,
      permissions: {
        mode: agent.sdk?.permissions?.mode ?? "default",
        default_behavior: agent.sdk?.permissions?.default_behavior ?? "deny",
        allow_mcp: agent.sdk?.permissions?.allow_mcp ?? true,
        allow_bash: agent.sdk?.permissions?.allow_bash ?? true,
        allow_web: agent.sdk?.permissions?.allow_web ?? true,
        allowed_mcp_tools: agent.sdk?.permissions?.allowed_mcp_tools ?? [],
        denied_bash_patterns: agent.sdk?.permissions?.denied_bash_patterns ?? [],
      },
      sandbox: {
        enabled: agent.sdk?.sandbox?.enabled ?? false,
        failIfUnavailable: agent.sdk?.sandbox?.failIfUnavailable ?? false,
        autoAllowBashIfSandboxed: agent.sdk?.sandbox?.autoAllowBashIfSandboxed ?? false,
        allowUnsandboxedCommands: agent.sdk?.sandbox?.allowUnsandboxedCommands ?? false,
        network: {
          allowedDomains: agent.sdk?.sandbox?.network?.allowedDomains ?? [],
          deniedDomains: agent.sdk?.sandbox?.network?.deniedDomains ?? [],
          allowManagedDomainsOnly: agent.sdk?.sandbox?.network?.allowManagedDomainsOnly ?? false,
          allowLocalBinding: agent.sdk?.sandbox?.network?.allowLocalBinding ?? false,
        },
        filesystem: {
          allowWrite: agent.sdk?.sandbox?.filesystem?.allowWrite ?? [],
          denyWrite: agent.sdk?.sandbox?.filesystem?.denyWrite ?? [],
          allowRead: agent.sdk?.sandbox?.filesystem?.allowRead ?? [],
          denyRead: agent.sdk?.sandbox?.filesystem?.denyRead ?? [],
          allowManagedReadPathsOnly: agent.sdk?.sandbox?.filesystem?.allowManagedReadPathsOnly ?? false,
        },
      },
    },
  });
  const [rawYaml, setRawYaml] = useState(agent.raw ?? "");
  const [externalMcpPreflight, setExternalMcpPreflight] = useState<Record<string, ExternalMcpPreflightState>>({});

  const update = (patch: Partial<typeof cfg>) => {
    setCfg((c) => ({ ...c, ...patch }));
    setDirty(true);
  };

  const updateSdk = (patch: Partial<typeof cfg.sdk>) => {
    update({ sdk: { ...cfg.sdk, ...patch } });
  };

  const updateSdkPermissions = (patch: Partial<typeof cfg.sdk.permissions>) => {
    updateSdk({ permissions: { ...cfg.sdk.permissions, ...patch } });
  };

  const updateSdkSandbox = (patch: Partial<typeof cfg.sdk.sandbox>) => {
    updateSdk({ sandbox: { ...cfg.sdk.sandbox, ...patch } });
  };

  const updateSdkSandboxNetwork = (patch: Partial<typeof cfg.sdk.sandbox.network>) => {
    updateSdkSandbox({ network: { ...cfg.sdk.sandbox.network, ...patch } });
  };

  const updateSdkSandboxFilesystem = (patch: Partial<typeof cfg.sdk.sandbox.filesystem>) => {
    updateSdkSandbox({ filesystem: { ...cfg.sdk.sandbox.filesystem, ...patch } });
  };

  const updateChannelContext = (patch: Partial<ChannelContextConfig>) => {
    update({ channel_context: { ...cfg.channel_context, ...patch } });
  };

  const updateWildcardChannelPrompt = (channel: "telegram" | "whatsapp", prompt: string) => {
    const current = cfg.channel_context[channel] ?? {};
    updateChannelContext({
      [channel]: {
        ...current,
        wildcard: {
          ...current.wildcard,
          prompt,
        },
      },
    });
  };

  const updateTelegramChannelRuleMap = (
    map: "peers" | "topics",
    value: Record<string, ChannelBehaviorRule>,
  ) => {
    const current = cfg.channel_context.telegram ?? {};
    updateChannelContext({
      telegram: {
        ...current,
        [map]: value,
      },
    });
  };

  const updateWhatsappChannelRuleMap = (
    map: "direct" | "groups",
    value: Record<string, ChannelBehaviorRule>,
  ) => {
    const current = cfg.channel_context.whatsapp ?? {};
    updateChannelContext({
      whatsapp: {
        ...current,
        [map]: value,
      },
    });
  };

  const buildChannelRule = (rule: ChannelBehaviorRule | undefined): ChannelBehaviorRule | undefined => {
    if (!rule) return undefined;
    const prompt = rule.prompt?.trim();
    const clean: ChannelBehaviorRule = {};
    if (prompt) clean.prompt = prompt;
    if (rule.reply_to_mode) clean.reply_to_mode = rule.reply_to_mode;
    return Object.keys(clean).length > 0 ? clean : undefined;
  };

  const buildChannelRuleMap = (
    rules: Record<string, ChannelBehaviorRule> | undefined,
  ): Record<string, ChannelBehaviorRule> | undefined => {
    if (!rules) return undefined;
    const clean = Object.fromEntries(
      Object.entries(rules)
        .map(([key, rule]) => [key, buildChannelRule(rule)] as const)
        .filter((entry): entry is readonly [string, ChannelBehaviorRule] => Boolean(entry[1])),
    );
    return Object.keys(clean).length > 0 ? clean : undefined;
  };

  const buildChannelContextPayload = (): ChannelContextConfig | undefined => {
    const clean: ChannelContextConfig = {};
    if (cfg.channel_context.reply_to_mode && cfg.channel_context.reply_to_mode !== "always") {
      clean.reply_to_mode = cfg.channel_context.reply_to_mode;
    }

    const telegramWildcard = buildChannelRule(cfg.channel_context.telegram?.wildcard);
    const telegramPeers = buildChannelRuleMap(cfg.channel_context.telegram?.peers);
    const telegramTopics = buildChannelRuleMap(cfg.channel_context.telegram?.topics);
    if (telegramWildcard || telegramPeers || telegramTopics) {
      clean.telegram = {
        ...(telegramWildcard ? { wildcard: telegramWildcard } : {}),
        ...(telegramPeers ? { peers: telegramPeers } : {}),
        ...(telegramTopics ? { topics: telegramTopics } : {}),
      };
    }

    const whatsappWildcard = buildChannelRule(cfg.channel_context.whatsapp?.wildcard);
    const whatsappDirect = buildChannelRuleMap(cfg.channel_context.whatsapp?.direct);
    const whatsappGroups = buildChannelRuleMap(cfg.channel_context.whatsapp?.groups);
    if (whatsappWildcard || whatsappDirect || whatsappGroups) {
      clean.whatsapp = {
        ...(whatsappWildcard ? { wildcard: whatsappWildcard } : {}),
        ...(whatsappDirect ? { direct: whatsappDirect } : {}),
        ...(whatsappGroups ? { groups: whatsappGroups } : {}),
      };
    }

    return Object.keys(clean).length > 0 ? clean : undefined;
  };

  const updateExternalMcpServer = (serverName: string, patch: Partial<ExternalMcpServerConfig>) => {
    update({
      external_mcp_servers: {
        ...cfg.external_mcp_servers,
        [serverName]: {
          ...cfg.external_mcp_servers[serverName],
          ...patch,
        },
      },
    });
  };

  const addExternalMcpServer = () => {
    const serverName = window.prompt("MCP server name");
    const name = serverName?.trim();
    if (!name) return;
    update({
      external_mcp_servers: {
        ...cfg.external_mcp_servers,
        [name]: {
          type: "stdio",
          command: "npx",
          args: [],
          allowed_tools: [],
        },
      },
    });
  };

  const enableMcpTools = (tools: string[]) => {
    const current = new Set(cfg.mcp_tools);
    for (const tool of tools) current.add(tool);

    const patch: Partial<typeof cfg> = { mcp_tools: [...current] };
    if (cfg.sdk.permissions.allowed_mcp_tools.length > 0) {
      const allowed = new Set(cfg.sdk.permissions.allowed_mcp_tools);
      for (const tool of tools) allowed.add(tool);
      patch.sdk = {
        ...cfg.sdk,
        permissions: {
          ...cfg.sdk.permissions,
          allowed_mcp_tools: [...allowed],
        },
      };
    }

    update(patch);
  };

  const nextExternalMcpName = (base: string) => {
    if (!cfg.external_mcp_servers[base]) return base;
    for (let index = 2; index < 20; index += 1) {
      const name = `${base}-${index}`;
      if (!cfg.external_mcp_servers[name]) return name;
    }
    return `${base}-${Date.now()}`;
  };

  const addExternalMcpPreset = (preset: "calendar" | "gmail") => {
    const name = nextExternalMcpName(preset);
    const server = preset === "calendar"
      ? {
          type: "stdio" as const,
          command: "npx",
          args: ["google-calendar-mcp"],
          env: {
            GOOGLE_CLIENT_ID: "",
            GOOGLE_CLIENT_SECRET: "",
            GOOGLE_REFRESH_TOKEN: "",
          },
          allowed_tools: [
            "calendar_daily_brief",
            "calendar_availability",
            "calendar_event_lookup",
            "calendar_meeting_prep",
          ],
        }
      : {
          type: "stdio" as const,
          command: "npx",
          args: ["gmail-mcp"],
          env: {
            GOOGLE_CLIENT_ID: "",
            GOOGLE_CLIENT_SECRET: "",
            GOOGLE_REFRESH_TOKEN: "",
          },
          allowed_tools: [
            "gmail_search",
            "gmail_thread_summary",
            "gmail_draft_reply",
          ],
        };
    update({
      external_mcp_servers: {
        ...cfg.external_mcp_servers,
        [name]: server,
      },
    });
  };

  const removeExternalMcpServer = (serverName: string) => {
    const { [serverName]: _removed, ...rest } = cfg.external_mcp_servers;
    update({ external_mcp_servers: rest });
  };

  const buildExternalMcpPayload = (): Record<string, ExternalMcpServerConfig> | undefined => {
    const entries = Object.entries(cfg.external_mcp_servers).flatMap(([serverName, server]) => {
      const name = serverName.trim();
      if (!name) return [];
      const type = server.type ?? "stdio";
      const clean: ExternalMcpServerConfig = { type };
      if (type === "stdio") {
        const command = server.command?.trim();
        if (!command) return [];
        clean.command = command;
        if (server.args?.length) clean.args = server.args;
        if (server.env && Object.keys(server.env).length > 0) clean.env = server.env;
      } else {
        const url = server.url?.trim();
        if (!url) return [];
        clean.url = url;
        if (server.headers && Object.keys(server.headers).length > 0) clean.headers = server.headers;
      }
      if (server.allowed_tools?.length) clean.allowed_tools = server.allowed_tools;
      return [[name, clean]] as Array<[string, ExternalMcpServerConfig]>;
    });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  };

  const buildExternalMcpSpecEntry = (server: ExternalMcpServerConfig): Record<string, unknown> | null => {
    const type = server.type ?? "stdio";
    if (type === "stdio") {
      const command = server.command?.trim();
      if (!command) return null;
      return {
        type: "stdio",
        command,
        ...(server.args?.length ? { args: server.args } : {}),
        ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
      };
    }
    const url = server.url?.trim();
    if (!url) return null;
    return {
      type,
      url,
      ...(server.headers && Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
    };
  };

  const preflightExternalMcpServer = async (serverName: string) => {
    const server = cfg.external_mcp_servers[serverName];
    const specEntry = buildExternalMcpSpecEntry(server);
    if (!specEntry) {
      setExternalMcpPreflight((state) => ({
        ...state,
        [serverName]: { error: "Set a command or URL before running preflight." },
      }));
      return;
    }

    setExternalMcpPreflight((state) => ({
      ...state,
      [serverName]: { loading: true },
    }));
    try {
      const res = await fetch(`/api/fleet/${serverId}/integrations/mcp-preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerAgentId: agentId,
          source: "external",
          spec: { [serverName]: specEntry },
          toolNamesByServer: {
            [serverName]: server.allowed_tools ?? [],
          },
        }),
      });
      if (!res.ok) throw new Error(`preflight ${res.status}`);
      const data = await res.json();
      const preflightServer = Array.isArray(data.servers) ? data.servers[0] as ExternalMcpPreflightServer | undefined : undefined;
      setExternalMcpPreflight((state) => ({
        ...state,
        [serverName]: preflightServer ? { server: preflightServer } : { error: "No preflight result returned." },
      }));
    } catch (err) {
      setExternalMcpPreflight((state) => ({
        ...state,
        [serverName]: { error: err instanceof Error ? err.message : "Preflight failed." },
      }));
    }
  };

  const buildSdkPayload = () => {
    const sdk: Record<string, unknown> = {};
    if (cfg.sdk.allowedTools.length > 0) sdk.allowedTools = cfg.sdk.allowedTools;
    if (cfg.sdk.disallowedTools.length > 0) sdk.disallowedTools = cfg.sdk.disallowedTools;
    if (cfg.sdk.fallbackModel.trim()) sdk.fallbackModel = cfg.sdk.fallbackModel.trim();
    if (cfg.sdk.promptSuggestions) sdk.promptSuggestions = true;
    if (cfg.sdk.agentProgressSummaries) sdk.agentProgressSummaries = true;
    if (cfg.sdk.includePartialMessages) sdk.includePartialMessages = true;
    if (cfg.sdk.includeHookEvents) sdk.includeHookEvents = true;
    if (cfg.sdk.enableFileCheckpointing) sdk.enableFileCheckpointing = true;

    const permissions: Record<string, unknown> = {};
    if (cfg.sdk.permissions.mode !== "default") permissions.mode = cfg.sdk.permissions.mode;
    if (cfg.sdk.permissions.default_behavior !== "deny") permissions.default_behavior = cfg.sdk.permissions.default_behavior;
    if (!cfg.sdk.permissions.allow_mcp) permissions.allow_mcp = false;
    if (!cfg.sdk.permissions.allow_bash) permissions.allow_bash = false;
    if (!cfg.sdk.permissions.allow_web) permissions.allow_web = false;
    if (cfg.sdk.permissions.allowed_mcp_tools.length > 0) permissions.allowed_mcp_tools = cfg.sdk.permissions.allowed_mcp_tools;
    if (cfg.sdk.permissions.denied_bash_patterns.length > 0) permissions.denied_bash_patterns = cfg.sdk.permissions.denied_bash_patterns;
    if (Object.keys(permissions).length > 0) sdk.permissions = permissions;

    const sandbox: Record<string, unknown> = {};
    if (cfg.sdk.sandbox.enabled) sandbox.enabled = true;
    if (cfg.sdk.sandbox.failIfUnavailable) sandbox.failIfUnavailable = true;
    if (cfg.sdk.sandbox.autoAllowBashIfSandboxed) sandbox.autoAllowBashIfSandboxed = true;
    if (cfg.sdk.sandbox.allowUnsandboxedCommands) sandbox.allowUnsandboxedCommands = true;

    const network: Record<string, unknown> = {};
    if (cfg.sdk.sandbox.network.allowedDomains.length > 0) network.allowedDomains = cfg.sdk.sandbox.network.allowedDomains;
    if (cfg.sdk.sandbox.network.deniedDomains.length > 0) network.deniedDomains = cfg.sdk.sandbox.network.deniedDomains;
    if (cfg.sdk.sandbox.network.allowManagedDomainsOnly) network.allowManagedDomainsOnly = true;
    if (cfg.sdk.sandbox.network.allowLocalBinding) network.allowLocalBinding = true;
    if (Object.keys(network).length > 0) sandbox.network = network;

    const filesystem: Record<string, unknown> = {};
    if (cfg.sdk.sandbox.filesystem.allowWrite.length > 0) filesystem.allowWrite = cfg.sdk.sandbox.filesystem.allowWrite;
    if (cfg.sdk.sandbox.filesystem.denyWrite.length > 0) filesystem.denyWrite = cfg.sdk.sandbox.filesystem.denyWrite;
    if (cfg.sdk.sandbox.filesystem.allowRead.length > 0) filesystem.allowRead = cfg.sdk.sandbox.filesystem.allowRead;
    if (cfg.sdk.sandbox.filesystem.denyRead.length > 0) filesystem.denyRead = cfg.sdk.sandbox.filesystem.denyRead;
    if (cfg.sdk.sandbox.filesystem.allowManagedReadPathsOnly) filesystem.allowManagedReadPathsOnly = true;
    if (Object.keys(filesystem).length > 0) sandbox.filesystem = filesystem;

    if (Object.keys(sandbox).length > 0) sdk.sandbox = sandbox;
    return Object.keys(sdk).length > 0 ? sdk : undefined;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let payload: unknown;
      if (mode === "raw") {
        payload = { yaml: rawYaml };
      } else {
        const {
          thinking,
          effort,
          maxTurns,
          maxBudgetUsd,
          sdk: _sdk,
          channel_context: _channelContext,
          external_mcp_servers: _externalMcpServers,
          iteration_budget: _iterationBudget,
          ...rest
        } = cfg;
        const clean: Record<string, unknown> = { ...rest };
        if (thinking.type !== "disabled") clean.thinking = thinking;
        if (effort && effort !== "high") clean.effort = effort;
        if (maxTurns > 0) clean.maxTurns = maxTurns;
        if (maxBudgetUsd > 0) clean.maxBudgetUsd = maxBudgetUsd;
        const channelContextPayload = buildChannelContextPayload();
        if (channelContextPayload) clean.channel_context = channelContextPayload;
        const externalMcpPayload = buildExternalMcpPayload();
        if (externalMcpPayload) clean.external_mcp_servers = externalMcpPayload;
        const iterationBudget: Record<string, unknown> = {
          max_tool_calls: cfg.iteration_budget.tool_call_limit,
          timeout_ms: cfg.iteration_budget.timeout_ms,
        };
        if (cfg.iteration_budget.absolute_timeout_ms > 0) {
          iterationBudget.absolute_timeout_ms = cfg.iteration_budget.absolute_timeout_ms;
        }
        clean.iteration_budget = iterationBudget;
        const sdkPayload = buildSdkPayload();
        if (sdkPayload) clean.sdk = sdkPayload;
        payload = clean;
      }
      await fetch(`/api/fleet/${serverId}/agents/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setDirty(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex max-w-[1100px] flex-col gap-3.5 p-5">
      {/* Mode toggle + save */}
      <div className="flex items-center justify-between gap-3">
        <div
          className="inline-flex gap-px rounded-[5px] border p-0.5"
          style={{ background: "var(--oc-bg2)", borderColor: "var(--oc-border)" }}
        >
          {(["form", "raw"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="h-6 rounded px-2.5 text-[11px] font-medium"
              style={{
                background: mode === m ? "var(--oc-bg3)" : "transparent",
                color: mode === m ? "var(--color-foreground)" : "var(--oc-text-dim)",
                border: "none",
                cursor: "pointer",
              }}
            >
              {m === "form" ? "Form" : "Raw YAML"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          {dirty && (
            <span
              className="flex items-center gap-1.5 text-[11.5px]"
              style={{ color: "var(--oc-yellow)" }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--oc-yellow)" }}
              />
              Unsaved changes
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => setDirty(false)}>
            Discard
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving..." : "Save config"}
          </Button>
        </div>
      </div>

      {mode === "form" ? (
        <>
          {/* General */}
          <Section title="General" tooltip="Core agent settings: model, timezone, message queue behavior, and memory rotation." icon={<Settings2 className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}>
            <FormGrid>
              <Field label="Model" tooltip="Which Claude model to use. Opus is the smartest, Haiku is the fastest and cheapest, Sonnet is a balanced option.">
                <select
                  value={cfg.model}
                  onChange={(e) => update({ model: e.target.value })}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Timezone" tooltip="Agent's timezone. Affects cron job schedules and timestamps in logs.">
                <select
                  value={cfg.timezone}
                  onChange={(e) => update({ timezone: e.target.value })}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Queue mode" tooltip="What happens to new messages while the agent is still responding. Collect queues and batches them. Steer is SDK-safe interrupt-and-restart until active input is promoted. Interrupt cancels and drops the new message.">
                <select
                  value={cfg.queue_mode}
                  onChange={(e) => update({ queue_mode: e.target.value })}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  <option value="collect">collect -- buffer and batch</option>
                  <option value="steer">steer -- interrupt and restart</option>
                  <option value="interrupt">interrupt -- cancel and restart</option>
                </select>
              </Field>
              <Field label="Session policy" tooltip="How often to reset conversation memory. Daily — fresh context each day. Never — the agent remembers everything. Weekly/Hourly — in between.">
                <select
                  value={cfg.session_policy}
                  onChange={(e) => update({ session_policy: e.target.value })}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {["never", "hourly", "daily", "weekly"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Auto-compress (tokens)" tooltip="When conversation context exceeds this token count, older messages are automatically compressed into a summary. 0 to disable.">
                <input
                  type="number"
                  value={cfg.auto_compress}
                  onChange={(e) => update({ auto_compress: +e.target.value || 0 })}
                  className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                  }}
                />
              </Field>
            </FormGrid>
          </Section>

          {/* Reasoning & limits */}
          <Section title="Reasoning & limits" tooltip="Thinking depth settings and resource limits: reasoning mode, turn limits, and per-query budget." icon={<Brain className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}>
            <FormGrid>
              <Field label="Thinking mode" tooltip="Extended thinking — the agent reasons before answering. Adaptive — the model decides when to think. Enabled — always thinks within a fixed budget. Disabled — responds immediately.">
                <select
                  value={cfg.thinking.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    update({
                      thinking: type === "enabled"
                        ? { type, budgetTokens: cfg.thinking.budgetTokens ?? 10000 }
                        : { type, budgetTokens: undefined },
                    });
                  }}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {THINKING_MODES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
              {cfg.thinking.type === "enabled" && (
                <Field label="Thinking budget (tokens)" tooltip="How many tokens the agent can spend on reasoning before answering. Higher = deeper thinking, but slower and more expensive.">
                  <input
                    type="number"
                    value={cfg.thinking.budgetTokens ?? 10000}
                    onChange={(e) =>
                      update({
                        thinking: { type: "enabled", budgetTokens: +e.target.value || 10000 },
                      })
                    }
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{
                      background: "var(--oc-bg3)",
                      borderColor: "var(--oc-border)",
                      color: "var(--color-foreground)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  />
                </Field>
              )}
              <Field label="Effort level" tooltip="How thoroughly the model processes the request. Low — quick, surface-level. High — deep analysis. Max — best quality, slowest.">
                <select
                  value={cfg.effort}
                  onChange={(e) => update({ effort: e.target.value })}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {EFFORT_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Max turns" tooltip="Maximum number of steps (tool calls) the agent can take per query. 0 means unlimited.">
                <input
                  type="number"
                  value={cfg.maxTurns}
                  onChange={(e) => update({ maxTurns: +e.target.value || 0 })}
                  className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                  }}
                />
              </Field>
              <Field label="Max budget (USD)" tooltip="Spending cap per query in USD. Protects against accidentally expensive requests. 0 means no limit.">
                <div className="relative">
                  <DollarSign
                    className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2"
                    style={{ color: "var(--oc-text-muted)" }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={cfg.maxBudgetUsd}
                    onChange={(e) => update({ maxBudgetUsd: +e.target.value || 0 })}
                    className="h-8 w-full rounded-[5px] border pl-6 pr-2 text-xs outline-none"
                    style={{
                      background: "var(--oc-bg3)",
                      borderColor: "var(--oc-border)",
                      color: "var(--color-foreground)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  />
                </div>
              </Field>
            </FormGrid>
          </Section>

          {/* Iteration budget */}
          <Section title="Iteration budget" tooltip="Limits for a single agent iteration: how many tools it can call and how long it can run.">
            <FormGrid>
              <Field label="Tool call limit" tooltip="Max tool calls per iteration. Prevents the agent from getting stuck in infinite loops.">
                <input
                  type="number"
                  value={cfg.iteration_budget.tool_call_limit}
                  onChange={(e) =>
                    update({
                      iteration_budget: {
                        ...cfg.iteration_budget,
                        tool_call_limit: +e.target.value,
                      },
                    })
                  }
                  className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                  }}
                />
              </Field>
              <Field label="Timeout (ms)" tooltip="Max execution time for one iteration in milliseconds. The agent is interrupted when this expires.">
                <input
                  type="number"
                  value={cfg.iteration_budget.timeout_ms}
                  onChange={(e) =>
                    update({
                      iteration_budget: {
                        ...cfg.iteration_budget,
                        timeout_ms: +e.target.value,
                      },
                    })
                  }
                  className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                  }}
                />
              </Field>
              <Field label="Absolute timeout (ms)" tooltip="Hard cap for one iteration even if tool activity continues. Set 0 to disable.">
                <input
                  type="number"
                  value={cfg.iteration_budget.absolute_timeout_ms}
                  onChange={(e) =>
                    update({
                      iteration_budget: {
                        ...cfg.iteration_budget,
                        absolute_timeout_ms: +e.target.value || 0,
                      },
                    })
                  }
                  className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                  }}
                />
              </Field>
            </FormGrid>
          </Section>

          {/* Access control */}
          <Section title="Access control" tooltip="Controls who can send direct messages to this agent." subtitle="Who can DM this agent.">
            <FormGrid>
              <Field label="Mode" tooltip="Who can DM the agent. Open — anyone. Code — user must enter a code first. Approve — admin approves each user. Off — DMs disabled.">
                <select
                  value={cfg.pairing.mode}
                  onChange={(e) =>
                    update({
                      pairing: { ...cfg.pairing, mode: e.target.value },
                    })
                  }
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  <option value="off">off -- no DMs accepted</option>
                  <option value="open">open -- anyone can DM</option>
                  <option value="code">code -- requires pairing code</option>
                  <option value="approve">approve -- admin approves each user</option>
                </select>
              </Field>
              {cfg.pairing.mode === "code" && (
                <Field label="Pairing code" tooltip="A secret code the user sends to the bot on first contact to gain access.">
                  <input
                    value={cfg.pairing.code}
                    onChange={(e) =>
                      update({
                        pairing: { ...cfg.pairing, code: e.target.value },
                      })
                    }
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{
                      background: "var(--oc-bg3)",
                      borderColor: "var(--oc-border)",
                      color: "var(--color-foreground)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  />
                </Field>
              )}
            </FormGrid>
          </Section>

          {/* Routes & allowlist */}
          <Section
            title="Routes"
            subtitle={`${cfg.routes.length} active`}
            tooltip="Which channels and chat types this agent listens to. Each route connects the agent to a Telegram or WhatsApp account with specific scope (DM, groups, or both)."
            icon={<Globe className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update({
                    routes: [
                      ...cfg.routes,
                      {
                        channel: "telegram",
                        account: "",
                        scope: "dm",
                        peers: null,
                        topics: null,
                        mentionOnly: false,
                      },
                    ],
                  })
                }
              >
                <Plus className="h-3 w-3" />
                Add route
              </Button>
            }
          >
            <RoutesTable
              routes={cfg.routes}
              allowlist={cfg.allowlist}
              onChange={(rs) => update({ routes: rs })}
              onAllowlistChange={(al) => update({ allowlist: al })}
            />
          </Section>

          {/* Channel behavior */}
          <Section
            title="Channel behavior"
            tooltip="Operator-configured channel context is injected as fenced, untrusted context. It adds behavior hints without replacing CLAUDE.md or mutating SDK sessions."
            icon={<MessageSquare className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
          >
            <FormGrid>
              <Field label="Reply target" tooltip="Controls reply threading for channel deliveries. Incoming reply only keeps replies scoped when the user replied to an existing message.">
                <select
                  value={cfg.channel_context.reply_to_mode ?? "always"}
                  onChange={(e) => updateChannelContext({ reply_to_mode: e.target.value as ReplyToMode })}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  <option value="always">always</option>
                  <option value="incoming_reply_only">incoming_reply_only</option>
                  <option value="never">never</option>
                </select>
              </Field>
              <Field label="Telegram wildcard" tooltip="Default Telegram operator context for chats without a more specific peer or topic rule. Fenced as untrusted channel context.">
                <textarea
                  value={cfg.channel_context.telegram?.wildcard?.prompt ?? ""}
                  onChange={(e) => updateWildcardChannelPrompt("telegram", e.target.value)}
                  rows={3}
                  placeholder="Operator context for Telegram chats"
                  className="min-h-[76px] w-full resize-y rounded-[5px] border px-2 py-1.5 text-xs outline-none"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                />
              </Field>
              <Field
                label="Per-chat Telegram rules"
                tooltip="Add a rule per Telegram chat ID (group or DM). The prompt is injected as untrusted operator context only when a message comes from that chat. Overrides the wildcard above. Use the optional reply-mode dropdown to override the global Reply target for this chat."
              >
                <ChannelRuleListEditor
                  rules={cfg.channel_context.telegram?.peers}
                  onChange={(value) => updateTelegramChannelRuleMap("peers", value)}
                  idLabel="Telegram chat ID"
                  idPlaceholder="-1003729315809"
                  promptPlaceholder="Context for this chat (multi-line OK)"
                  emptyHint="No per-chat rules. Add one to give the agent extra context for a specific Telegram chat."
                />
              </Field>
              <Field
                label="Per-topic Telegram rules"
                tooltip="Add a rule per forum-topic ID (the part after thread_id in a Telegram forum group). Topic rules override per-chat and wildcard rules for messages posted in that topic."
              >
                <ChannelRuleListEditor
                  rules={cfg.channel_context.telegram?.topics}
                  onChange={(value) => updateTelegramChannelRuleMap("topics", value)}
                  idLabel="Telegram topic ID"
                  idPlaceholder="4"
                  promptPlaceholder="Context for this topic (multi-line OK)"
                  emptyHint="No per-topic rules. Add one to specialize behavior inside a forum topic."
                />
              </Field>
              <Field label="WhatsApp wildcard" tooltip="Default WhatsApp operator context for chats without a more specific direct or group rule. Fenced as untrusted channel context.">
                <textarea
                  value={cfg.channel_context.whatsapp?.wildcard?.prompt ?? ""}
                  onChange={(e) => updateWildcardChannelPrompt("whatsapp", e.target.value)}
                  rows={3}
                  placeholder="Operator context for WhatsApp chats"
                  className="min-h-[76px] w-full resize-y rounded-[5px] border px-2 py-1.5 text-xs outline-none"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                  }}
                />
              </Field>
              <Field
                label="Per-contact WhatsApp rules"
                tooltip="Add a rule per WhatsApp contact JID (e.g. 77001234567@s.whatsapp.net). Direct rules override the WhatsApp wildcard for messages from that contact."
              >
                <ChannelRuleListEditor
                  rules={cfg.channel_context.whatsapp?.direct}
                  onChange={(value) => updateWhatsappChannelRuleMap("direct", value)}
                  idLabel="WhatsApp JID"
                  idPlaceholder="77001234567@s.whatsapp.net"
                  promptPlaceholder="Context for this contact (multi-line OK)"
                  emptyHint="No per-contact rules."
                />
              </Field>
              <Field
                label="Per-group WhatsApp rules"
                tooltip="Add a rule per WhatsApp group JID (ends in @g.us). Group rules override the WhatsApp wildcard for messages posted in that group."
              >
                <ChannelRuleListEditor
                  rules={cfg.channel_context.whatsapp?.groups}
                  onChange={(value) => updateWhatsappChannelRuleMap("groups", value)}
                  idLabel="WhatsApp group JID"
                  idPlaceholder="120363000000000000@g.us"
                  promptPlaceholder="Context for this group (multi-line OK)"
                  emptyHint="No per-group rules."
                />
              </Field>
            </FormGrid>
          </Section>

          {/* Quick commands */}
          <Section
            title="Quick commands"
            subtitle={`${Object.keys(cfg.quick_commands).length} commands`}
            tooltip="Slash commands that run shell scripts instantly without calling the LLM. Users type /name in chat and get the output."
            icon={<Zap className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
            action={
              <Button variant="outline" size="sm" onClick={() => {
                const name = prompt("Command name (e.g. status):");
                if (name) update({ quick_commands: { ...cfg.quick_commands, [name]: { command: "", timeout: 30 } } });
              }}>
                <Plus className="h-3 w-3" />
                Add
              </Button>
            }
          >
            {Object.keys(cfg.quick_commands).length === 0 ? (
              <div className="p-5 text-center text-xs" style={{ color: "var(--oc-text-muted)" }}>
                No quick commands. Users type /<em>name</em> and the shell command runs instantly (no LLM).
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {Object.entries(cfg.quick_commands).map(([name, cmd]) => (
                  <div key={name} className="flex items-center gap-2 rounded-[5px] border p-2" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
                    <span className="w-[80px] shrink-0 text-[11px] font-medium" style={{ color: "var(--oc-accent)", fontFamily: "var(--oc-mono)" }}>/{name}</span>
                    <input
                      value={cmd.command}
                      onChange={(e) => update({ quick_commands: { ...cfg.quick_commands, [name]: { ...cmd, command: e.target.value } } })}
                      placeholder="shell command"
                      className="h-6 flex-1 rounded border px-1.5 text-[11px] outline-none"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                    />
                    <input
                      type="number"
                      value={cmd.timeout}
                      onChange={(e) => update({ quick_commands: { ...cfg.quick_commands, [name]: { ...cmd, timeout: +e.target.value || 30 } } })}
                      className="h-6 w-[50px] rounded border px-1 text-center text-[11px] outline-none"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                      title="Timeout (seconds)"
                    />
                    <button onClick={() => { const { [name]: _, ...rest } = cfg.quick_commands; update({ quick_commands: rest }); }}
                      className="inline-flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--oc-bg3)]" style={{ color: "var(--oc-text-dim)" }}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Cron jobs */}
          <Section
            title="Scheduled tasks"
            subtitle={cfg.cron.length > 0 ? `${cfg.cron.filter(j => j.enabled).length} active · ${cfg.cron.filter(j => !j.enabled).length} paused` : undefined}
            tooltip="Recurring prompts that run on a cron schedule. The agent executes the prompt automatically and can deliver the result to a chat."
            icon={<Clock className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
            action={
              <Button variant="outline" size="sm" onClick={() => update({
                cron: [...cfg.cron, { id: `task-${cfg.cron.length + 1}`, schedule: "0 9 * * *", prompt: "", enabled: true }],
              })}>
                <Plus className="h-3 w-3" />
                New task
              </Button>
            }
          >
            {cfg.cron.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <Clock className="h-6 w-6" style={{ color: "var(--oc-text-muted)" }} />
                <div className="text-center text-xs" style={{ color: "var(--oc-text-muted)" }}>
                  No scheduled tasks yet.<br />
                  Set up recurring prompts — the agent runs them automatically.
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {cfg.cron.map((job, i) => {
                  const cronEdit = (patch: Partial<typeof job>) =>
                    update({ cron: cfg.cron.map((j, k) => k === i ? { ...j, ...patch } : j) });
                  return (
                    <div
                      key={job.id}
                      className="rounded-md"
                      style={{
                        background: "var(--oc-bg2)",
                        border: `1px solid ${job.enabled ? "var(--oc-border)" : "var(--oc-border)"}`,
                        opacity: job.enabled ? 1 : 0.55,
                      }}
                    >
                      {/* Header row */}
                      <div
                        className="flex items-center gap-2.5 px-3 py-2"
                        style={{ borderBottom: "1px solid var(--oc-border)" }}
                      >
                        <button
                          onClick={() => cronEdit({ enabled: !job.enabled })}
                          className="flex h-5 w-[34px] shrink-0 items-center rounded-full p-0.5"
                          style={{
                            background: job.enabled ? "var(--oc-accent)" : "var(--oc-bg3)",
                            justifyContent: job.enabled ? "flex-end" : "flex-start",
                          }}
                        >
                          <div
                            className="h-3.5 w-3.5 rounded-full"
                            style={{ background: job.enabled ? "#0b0d12" : "var(--oc-text-muted)" }}
                          />
                        </button>
                        <input
                          value={job.id}
                          onChange={(e) => cronEdit({ id: e.target.value })}
                          className="h-6 w-[140px] rounded border px-1.5 text-[12px] font-medium outline-none"
                          style={{
                            background: "transparent",
                            borderColor: "transparent",
                            color: "var(--color-foreground)",
                          }}
                          placeholder="Task name"
                        />
                        <span
                          className="ml-auto text-[10.5px]"
                          style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
                        >
                          {describeCron(job.schedule)}
                        </span>
                        <button
                          onClick={() => update({ cron: cfg.cron.filter((_, k) => k !== i) })}
                          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--oc-bg3)]"
                          style={{ color: "var(--oc-text-dim)" }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>

                      {/* Body */}
                      <div className="flex flex-col gap-3 p-3">
                        {/* Schedule */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
                            Schedule
                          </label>
                          <div className="flex gap-2">
                            <select
                              value={SCHEDULE_PRESETS.find(p => p.cron === job.schedule) ? job.schedule : "__custom"}
                              onChange={(e) => {
                                if (e.target.value !== "__custom") cronEdit({ schedule: e.target.value });
                              }}
                              className="h-7 cursor-pointer rounded-[5px] border px-2 text-[11px]"
                              style={{
                                background: "var(--oc-bg3)",
                                borderColor: "var(--oc-border)",
                                color: "var(--color-foreground)",
                              }}
                            >
                              {SCHEDULE_PRESETS.map((p) => (
                                <option key={p.cron} value={p.cron}>{p.label}</option>
                              ))}
                              {!SCHEDULE_PRESETS.find(p => p.cron === job.schedule) && (
                                <option value="__custom">Custom: {job.schedule}</option>
                              )}
                            </select>
                            <input
                              value={job.schedule}
                              onChange={(e) => cronEdit({ schedule: e.target.value })}
                              className="h-7 w-[140px] rounded-[5px] border px-2 text-[11px] outline-none"
                              style={{
                                background: "var(--oc-bg3)",
                                borderColor: "var(--oc-border)",
                                color: "var(--oc-text-dim)",
                                fontFamily: "var(--oc-mono)",
                              }}
                              placeholder="* * * * *"
                              title="Cron expression: minute hour day month weekday"
                            />
                          </div>
                        </div>

                        {/* Prompt */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
                            Prompt
                          </label>
                          <textarea
                            value={job.prompt}
                            onChange={(e) => cronEdit({ prompt: e.target.value })}
                            rows={2}
                            className="w-full resize-none rounded-[5px] border px-2 py-1.5 text-[11.5px] leading-relaxed outline-none"
                            style={{
                              background: "var(--oc-bg3)",
                              borderColor: "var(--oc-border)",
                              color: "var(--color-foreground)",
                            }}
                            placeholder="What should the agent do when this task runs?"
                          />
                        </div>

                        {/* Deliver to */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
                            Send response to
                          </label>
                          <div className="flex gap-2">
                            <select
                              value={job.deliver_to?.channel ?? ""}
                              onChange={(e) =>
                                cronEdit({
                                  deliver_to: e.target.value
                                    ? {
                                        channel: e.target.value,
                                        peer_id: job.deliver_to?.peer_id ?? "",
                                        account_id: job.deliver_to?.account_id,
                                      }
                                    : undefined,
                                })
                              }
                              className="h-7 cursor-pointer rounded-[5px] border px-2 text-[11px]"
                              style={{
                                background: "var(--oc-bg3)",
                                borderColor: "var(--oc-border)",
                                color: "var(--color-foreground)",
                              }}
                            >
                              <option value="">Log only (no delivery)</option>
                              <option value="telegram">Telegram</option>
                              <option value="whatsapp">WhatsApp</option>
                            </select>
                            {job.deliver_to?.channel && (
                              <input
                                value={job.deliver_to?.peer_id ?? ""}
                                onChange={(e) =>
                                  cronEdit({
                                    deliver_to: {
                                      channel: job.deliver_to?.channel ?? "telegram",
                                      peer_id: e.target.value,
                                      account_id: job.deliver_to?.account_id,
                                    },
                                  })
                                }
                                className="h-7 flex-1 rounded-[5px] border px-2 text-[11px] outline-none"
                                style={{
                                  background: "var(--oc-bg3)",
                                  borderColor: "var(--oc-border)",
                                  color: "var(--color-foreground)",
                                  fontFamily: "var(--oc-mono)",
                                }}
                                placeholder="Chat ID or phone number"
                              />
                            )}
                          </div>
                          {!job.deliver_to?.channel && (
                            <p className="text-[10.5px]" style={{ color: "var(--oc-text-muted)" }}>
                              Response will be logged but not sent to any chat.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* MCP tools */}
          <Section title="MCP tools" subtitle={`${cfg.mcp_tools.length} enabled`}
            tooltip="External tools the agent can use via the Model Context Protocol. These extend what the agent can do beyond just text responses."
            icon={<List className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
            action={
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => enableMcpTools(["local_note_search"])}>
                  Notes search
                </Button>
                <Button variant="outline" size="sm" onClick={() => enableMcpTools(["local_note_propose"])}>
                  Note proposals
                </Button>
              </div>
            }>
            <Field label="Tools" tooltip="External tools (MCP) available to this agent: search, memory, messaging, etc. Comma-separated list of tool names.">
              <input value={cfg.mcp_tools.join(", ")}
                onChange={(e) => update({ mcp_tools: e.target.value ? e.target.value.split(",").map(s => s.trim()).filter(Boolean) : [] })}
                placeholder="memory_search, memory_write, send_message, ..."
                className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }} />
            </Field>
          </Section>

          <Section
            title="Memory extraction"
            tooltip="Post-run memory candidates are proposed for review after successful runs. They are not searchable until an operator approves them."
            icon={<Brain className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
          >
            <div className="flex flex-col gap-3.5">
              <ToggleField
                label="Propose post-run candidates"
                tooltip="Run a bounded, tools-disabled extraction pass after selected successful runs. Candidates land in the pending memory review queue."
                checked={cfg.memory_extraction.enabled}
                onChange={(enabled) => update({
                  memory_extraction: {
                    ...cfg.memory_extraction,
                    enabled,
                  },
                })}
              />
              <FormGrid>
                <Field label="Max candidates" tooltip="Maximum memory candidates to propose from one completed run. Backend accepts 1-10.">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={cfg.memory_extraction.max_candidates}
                    onChange={(e) => update({
                      memory_extraction: {
                        ...cfg.memory_extraction,
                        max_candidates: Math.min(10, Math.max(1, +e.target.value || 1)),
                      },
                    })}
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
                <Field label="Max input chars" tooltip="Maximum response text passed into the extraction prompt. Backend accepts 500-20000.">
                  <input
                    type="number"
                    min={500}
                    max={20000}
                    value={cfg.memory_extraction.max_input_chars}
                    onChange={(e) => update({
                      memory_extraction: {
                        ...cfg.memory_extraction,
                        max_input_chars: Math.min(20000, Math.max(500, +e.target.value || 500)),
                      },
                    })}
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
              </FormGrid>
            </div>
          </Section>

          <Section
            title="External MCP servers"
            subtitle={`${Object.keys(cfg.external_mcp_servers).length} configured`}
            tooltip="SDK-native external MCP servers for pilot integrations. These are passed into Claude Agent SDK mcpServers, not executed through a custom harness runtime."
            icon={<Plug className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
            action={
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => addExternalMcpPreset("calendar")}>
                  Calendar
                </Button>
                <Button variant="outline" size="sm" onClick={() => addExternalMcpPreset("gmail")}>
                  Gmail
                </Button>
                <Button variant="outline" size="sm" onClick={addExternalMcpServer}>
                  <Plus className="h-3 w-3" />
                  Add server
                </Button>
              </div>
            }
          >
            {Object.keys(cfg.external_mcp_servers).length === 0 ? (
              <div className="p-5 text-center text-xs" style={{ color: "var(--oc-text-muted)" }}>
                No external MCP servers. Add one for a Google Calendar, Gmail, or other stdio/http MCP pilot.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {Object.entries(cfg.external_mcp_servers).map(([serverName, server]) => {
                  const type = server.type ?? "stdio";
                  const preflight = externalMcpPreflight[serverName];
                  return (
                    <div
                      key={serverName}
                      className="rounded-[5px] border p-3"
                      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                            {serverName}
                          </div>
                          <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
                            {type} / {(server.allowed_tools ?? []).length} allowed tools
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void preflightExternalMcpServer(serverName)}
                            disabled={preflight?.loading}
                            className="h-7 px-2"
                          >
                            <Shield className="h-3.5 w-3.5" />
                            {preflight?.loading ? "Checking" : "Preflight"}
                          </Button>
                          <button
                            onClick={() => removeExternalMcpServer(serverName)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--oc-bg3)]"
                            style={{ color: "var(--oc-text-dim)" }}
                            title="Remove external MCP server"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
                        <Field label="Transport" tooltip="SDK MCP transport for this external server. stdio is the common local MCP shape; sse/http are remote transports.">
                          <select
                            value={type}
                            onChange={(e) => updateExternalMcpServer(serverName, { type: e.target.value as ExternalMcpServerConfig["type"] })}
                            className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                            style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
                          >
                            <option value="stdio">stdio</option>
                            <option value="sse">sse</option>
                            <option value="http">http</option>
                          </select>
                        </Field>
                        {type === "stdio" ? (
                          <Field label="Command" tooltip="Executable command passed to the SDK MCP server config.">
                            <input
                              value={server.command ?? ""}
                              onChange={(e) => updateExternalMcpServer(serverName, { command: e.target.value })}
                              placeholder="npx"
                              className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                            />
                          </Field>
                        ) : (
                          <Field label="URL" tooltip="Remote MCP endpoint URL.">
                            <input
                              value={server.url ?? ""}
                              onChange={(e) => updateExternalMcpServer(serverName, { url: e.target.value })}
                              placeholder="https://mcp.example.com"
                              className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                            />
                          </Field>
                        )}
                      </div>
                      <FormGrid>
                        {type === "stdio" ? (
                          <>
                            <Field label="Args" tooltip="Arguments passed to the MCP process. Comma-separated.">
                              <input
                                value={arrayToCsv(server.args)}
                                onChange={(e) => updateExternalMcpServer(serverName, { args: csvToArray(e.target.value) })}
                                placeholder="google-calendar-mcp"
                                className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                                style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                              />
                            </Field>
                            <Field label="Env" tooltip="Environment passed to the MCP process. One KEY=value per line. Values are redacted in preflight responses.">
                              <textarea
                                value={mapToEnvText(server.env)}
                                onChange={(e) => updateExternalMcpServer(serverName, { env: envTextToMap(e.target.value) })}
                                rows={3}
                                placeholder="GOOGLE_CLIENT_ID=..."
                                className="min-h-[76px] w-full resize-y rounded-[5px] border px-2 py-1.5 text-xs outline-none"
                                style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                              />
                            </Field>
                          </>
                        ) : (
                          <Field label="Headers" tooltip="Optional request headers for remote MCP. One KEY=value per line.">
                            <textarea
                              value={mapToEnvText(server.headers)}
                              onChange={(e) => updateExternalMcpServer(serverName, { headers: envTextToMap(e.target.value) })}
                              rows={3}
                              placeholder="Authorization=Bearer ..."
                              className="min-h-[76px] w-full resize-y rounded-[5px] border px-2 py-1.5 text-xs outline-none"
                              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                            />
                          </Field>
                        )}
                        <Field label="Allowed tools" tooltip="Explicit tool names allowed from this server. These become mcp__server__tool entries in SDK allowedTools.">
                          <input
                            value={arrayToCsv(server.allowed_tools)}
                            onChange={(e) => updateExternalMcpServer(serverName, { allowed_tools: csvToArray(e.target.value) })}
                            placeholder="calendar_daily_brief, calendar_lookup"
                            className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                            style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                          />
                        </Field>
                      </FormGrid>
                      {preflight && (
                        <ExternalMcpPreflightResult state={preflight} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Display & sessions */}
          <Section title="Display & sessions"
            tooltip="How the agent's responses appear in chat and how sessions are managed in group conversations."
            icon={<Monitor className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}>
            <FormGrid>
              <Field label="Group sessions" tooltip="How sessions work in group chats. Shared — one context for the whole group. Per_user — each member gets their own conversation history.">
                <select value={cfg.group_sessions}
                  onChange={(e) => update({ group_sessions: e.target.value })}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}>
                  <option value="shared">shared</option>
                  <option value="per_user">per_user</option>
                </select>
              </Field>
              <Field label="Max sessions" tooltip="Maximum number of active sessions. Oldest sessions are automatically evicted when this limit is exceeded.">
                <input type="number" value={cfg.maxSessions}
                  onChange={(e) => update({ maxSessions: +e.target.value || 100 })}
                  className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                  style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }} />
              </Field>
              <Field label="Tool progress" tooltip="Whether to show tool call activity to users. All — every call. New — only new ones. Off — hidden.">
                <select value={cfg.display?.toolProgress ?? "all"}
                  onChange={(e) => update({ display: { ...cfg.display, toolProgress: e.target.value } })}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}>
                  <option value="all">all — show every tool call</option>
                  <option value="new">new — only new tool calls</option>
                  <option value="off">off — hide tool calls</option>
                </select>
              </Field>
              <Field label="Streaming" tooltip="Stream output — text appears as it's generated, not all at once. Works in Telegram via message editing.">
                <select value={cfg.display?.streaming === true ? "true" : cfg.display?.streaming === false ? "false" : "auto"}
                  onChange={(e) => update({ display: { ...cfg.display, streaming: e.target.value === "auto" ? undefined : e.target.value === "true" } })}
                  className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                  style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}>
                  <option value="auto">auto (platform default)</option>
                  <option value="true">enabled</option>
                  <option value="false">disabled</option>
                </select>
              </Field>
            </FormGrid>
          </Section>


          {/* Claude Agent SDK */}
          <Section title="Claude Agent SDK"
            tooltip="Native Claude Agent SDK controls passed through buildSdkOptions. These do not create a separate LLM runtime."
            icon={<Key className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}>
            <div className="flex flex-col gap-4">
              <div
                className="rounded-md border px-3 py-2.5"
                style={{
                  background: "var(--oc-bg2)",
                  borderColor: "var(--oc-accent-ring)",
                  color: "var(--oc-text-dim)",
                }}
              >
                <div className="mb-1 flex items-center gap-2">
                  <Key className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />
                  <span className="text-[12px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                    Strict native runtime
                  </span>
                </div>
                <p className="text-[11.5px] leading-relaxed">
                  These settings are passed to Claude Agent SDK/Claude Code. OpenClaw does not run an outer LLM failover loop or a custom tool execution path.
                </p>
              </div>
              <FormGrid>
                <Field label="Fallback model" tooltip="Native SDK fallbackModel. Used only inside the Claude Agent SDK query lifecycle, not as OpenClaw-side provider routing.">
                  <select
                    value={cfg.sdk.fallbackModel || ""}
                    onChange={(e) => updateSdk({ fallbackModel: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
                  >
                    <option value="">none</option>
                    {MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Allowed built-in tools" tooltip="SDK built-in tools, comma-separated. Example: Read, Edit, Bash. Leave empty to use runtime defaults.">
                  <input
                    value={arrayToCsv(cfg.sdk.allowedTools)}
                    onChange={(e) => updateSdk({ allowedTools: csvToArray(e.target.value) })}
                    placeholder="Read, Edit, Bash"
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
                <Field label="Disallowed built-in tools" tooltip="SDK built-in tools to deny, comma-separated. Useful for explicit restrictions.">
                  <input
                    value={arrayToCsv(cfg.sdk.disallowedTools)}
                    onChange={(e) => updateSdk({ disallowedTools: csvToArray(e.target.value) })}
                    placeholder="WebSearch, Bash"
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
                <Field label="Permission mode" tooltip="Native SDK permission mode. default keeps approvals/policy normal; dontAsk is stricter headless policy behavior.">
                  <select
                    value={cfg.sdk.permissions.mode}
                    onChange={(e) => updateSdkPermissions({ mode: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
                  >
                    {SDK_PERMISSION_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="MCP allowlist" tooltip="MCP tools that can pass canUseTool when MCP is allowed. Comma-separated.">
                  <input
                    value={arrayToCsv(cfg.sdk.permissions.allowed_mcp_tools)}
                    onChange={(e) => updateSdkPermissions({ allowed_mcp_tools: csvToArray(e.target.value) })}
                    placeholder="memory_search, session_search"
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
                <Field label="Denied Bash patterns" tooltip="Shell command substrings blocked by the SDK permission hook. Comma-separated.">
                  <input
                    value={arrayToCsv(cfg.sdk.permissions.denied_bash_patterns)}
                    onChange={(e) => updateSdkPermissions({ denied_bash_patterns: csvToArray(e.target.value) })}
                    placeholder="npm publish, rm -rf"
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
              </FormGrid>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <ToggleField label="Prompt suggestions" tooltip="Show SDK prompt_suggestion events as the next suggested message." checked={cfg.sdk.promptSuggestions} onChange={(checked) => updateSdk({ promptSuggestions: checked })} />
                <ToggleField label="Progress summaries" tooltip="Surface SDK task_progress events in chat while work is running." checked={cfg.sdk.agentProgressSummaries} onChange={(checked) => updateSdk({ agentProgressSummaries: checked })} />
                <ToggleField label="Partial messages" tooltip="Stream native partial message deltas when the SDK emits them." checked={cfg.sdk.includePartialMessages} onChange={(checked) => updateSdk({ includePartialMessages: checked })} />
                <ToggleField label="Hook events" tooltip="Surface SDK hook lifecycle events in the chat debug rail." checked={cfg.sdk.includeHookEvents} onChange={(checked) => updateSdk({ includeHookEvents: checked })} />
                <ToggleField label="File checkpoints" tooltip="Enable native SDK file checkpoint handles for rewind." checked={cfg.sdk.enableFileCheckpointing} onChange={(checked) => updateSdk({ enableFileCheckpointing: checked })} />
                <ToggleField label="Sandbox" tooltip="Enable SDK sandbox options when available in the environment." checked={cfg.sdk.sandbox.enabled} onChange={(checked) => updateSdkSandbox({ enabled: checked })} />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <ToggleField label="Allow MCP" checked={cfg.sdk.permissions.allow_mcp} onChange={(checked) => updateSdkPermissions({ allow_mcp: checked })} />
                <ToggleField label="Allow Bash" checked={cfg.sdk.permissions.allow_bash} onChange={(checked) => updateSdkPermissions({ allow_bash: checked })} />
                <ToggleField label="Allow Web" checked={cfg.sdk.permissions.allow_web} onChange={(checked) => updateSdkPermissions({ allow_web: checked })} />
                <ToggleField label="Sandbox required" checked={cfg.sdk.sandbox.failIfUnavailable} onChange={(checked) => updateSdkSandbox({ failIfUnavailable: checked })} />
                <ToggleField label="Sandbox allows Bash" checked={cfg.sdk.sandbox.autoAllowBashIfSandboxed} onChange={(checked) => updateSdkSandbox({ autoAllowBashIfSandboxed: checked })} />
                <ToggleField label="Unsandboxed commands" checked={cfg.sdk.sandbox.allowUnsandboxedCommands} onChange={(checked) => updateSdkSandbox({ allowUnsandboxedCommands: checked })} />
              </div>

              <FormGrid>
                <Field label="Network allow domains" tooltip="Sandbox network domains to allow. Comma-separated.">
                  <input
                    value={arrayToCsv(cfg.sdk.sandbox.network.allowedDomains)}
                    onChange={(e) => updateSdkSandboxNetwork({ allowedDomains: csvToArray(e.target.value) })}
                    placeholder="api.example.com, docs.example.com"
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
                <Field label="Network deny domains" tooltip="Sandbox network domains to deny. Comma-separated.">
                  <input
                    value={arrayToCsv(cfg.sdk.sandbox.network.deniedDomains)}
                    onChange={(e) => updateSdkSandboxNetwork({ deniedDomains: csvToArray(e.target.value) })}
                    placeholder="metadata.google.internal"
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
                <Field label="Filesystem allow write" tooltip="Sandbox write paths to allow. Comma-separated.">
                  <input
                    value={arrayToCsv(cfg.sdk.sandbox.filesystem.allowWrite)}
                    onChange={(e) => updateSdkSandboxFilesystem({ allowWrite: csvToArray(e.target.value) })}
                    placeholder="agents/example, /tmp/openclaw"
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
                <Field label="Filesystem deny write" tooltip="Sandbox write paths to deny. Comma-separated.">
                  <input
                    value={arrayToCsv(cfg.sdk.sandbox.filesystem.denyWrite)}
                    onChange={(e) => updateSdkSandboxFilesystem({ denyWrite: csvToArray(e.target.value) })}
                    placeholder=".env, config.yml"
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
              </FormGrid>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <ToggleField label="Managed domains only" checked={cfg.sdk.sandbox.network.allowManagedDomainsOnly} onChange={(checked) => updateSdkSandboxNetwork({ allowManagedDomainsOnly: checked })} />
                <ToggleField label="Allow local binding" checked={cfg.sdk.sandbox.network.allowLocalBinding} onChange={(checked) => updateSdkSandboxNetwork({ allowLocalBinding: checked })} />
                <ToggleField label="Managed read paths only" checked={cfg.sdk.sandbox.filesystem.allowManagedReadPathsOnly} onChange={(checked) => updateSdkSandboxFilesystem({ allowManagedReadPathsOnly: checked })} />
              </div>
            </div>
          </Section>


          {/* Hooks */}
          <Section title="Hooks" subtitle={`${cfg.hooks.length} hooks`}
            tooltip="Trigger webhooks or shell scripts when agent events happen — e.g. after a query completes, when a session resets, or when a cron job fires."
            icon={<Globe className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
            action={
              <Button variant="outline" size="sm" onClick={() => update({
                hooks: [...cfg.hooks, { event: "on_after_query", action: "webhook", url: "", timeout_ms: 5000 }],
              })}>
                <Plus className="h-3 w-3" />
                Add hook
              </Button>
            }>
            {cfg.hooks.length === 0 ? (
              <div className="p-5 text-center text-xs" style={{ color: "var(--oc-text-muted)" }}>
                No hooks. Trigger webhooks or scripts on agent events.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {cfg.hooks.map((hook, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-[5px] border p-2" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
                    <select value={hook.event}
                      onChange={(e) => update({ hooks: cfg.hooks.map((h, k) => k === i ? { ...h, event: e.target.value } : h) })}
                      className="h-6 cursor-pointer rounded border px-1 text-[11px]"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}>
                      {HOOK_EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>
                    <select value={hook.action}
                      onChange={(e) => update({ hooks: cfg.hooks.map((h, k) => k === i ? { ...h, action: e.target.value } : h) })}
                      className="h-6 w-[80px] cursor-pointer rounded border px-1 text-[11px]"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}>
                      <option value="webhook">webhook</option>
                      <option value="script">script</option>
                    </select>
                    <input value={hook.action === "webhook" ? hook.url ?? "" : hook.command ?? ""}
                      onChange={(e) => update({ hooks: cfg.hooks.map((h, k) => k === i ? { ...h, [h.action === "webhook" ? "url" : "command"]: e.target.value } : h) })}
                      placeholder={hook.action === "webhook" ? "https://..." : "script.sh"}
                      className="h-6 flex-1 rounded border px-1.5 text-[11px] outline-none"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }} />
                    <button onClick={() => update({ hooks: cfg.hooks.filter((_, k) => k !== i) })}
                      className="inline-flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--oc-bg3)]" style={{ color: "var(--oc-text-dim)" }}>
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Advanced */}
          <Section title="Advanced"
            tooltip="Power-user settings: sub-agent delegation and SDK-native orchestration boundaries."
            icon={<Terminal className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}>
            <div className="flex flex-col gap-3.5">
              <Field label="Subagents" tooltip="Other agents this one can delegate subtasks to. For example, one agent talks to the user while another does research.">
                <input value={cfg.subagents.allow.join(", ")}
                  onChange={(e) => update({ subagents: { ...cfg.subagents, allow: csvToArray(e.target.value) } })}
                  placeholder="research-agent, code-agent"
                  className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                  style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }} />
              </Field>
              <FormGrid>
                <Field label="Max spawn depth" tooltip="SDK delegation surface policy. 0 disables direct subagent exposure, 1 allows direct subagents, 2 allows nested subagents.">
                  <input
                    type="number"
                    value={cfg.subagents.max_spawn_depth}
                    onChange={(e) => update({
                      subagents: {
                        ...cfg.subagents,
                        max_spawn_depth: Math.max(0, +e.target.value || 0),
                      },
                    })}
                    className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
                  />
                </Field>
                <Field label="Conflict mode" tooltip="Soft records sibling file ownership conflicts and allows them. Strict denies conflicting writes through SDK permission hooks.">
                  <select
                    value={cfg.subagents.conflict_mode}
                    onChange={(e) => update({
                      subagents: {
                        ...cfg.subagents,
                        conflict_mode: e.target.value as "soft" | "strict",
                      },
                    })}
                    className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                    style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
                  >
                    <option value="soft">soft -- record conflicts</option>
                    <option value="strict">strict -- deny conflicts</option>
                  </select>
                </Field>
              </FormGrid>
              {cfg.subagents.allow.length > 0 && (
                <div className="flex flex-col gap-2">
                  {cfg.subagents.allow.map((subagentId) => {
                    const role = cfg.subagents.roles?.[subagentId] ?? {};
                    const updateRole = (patch: Partial<typeof role>) => update({
                      subagents: {
                        ...cfg.subagents,
                        roles: {
                          ...cfg.subagents.roles,
                          [subagentId]: {
                            ...role,
                            ...patch,
                          },
                        },
                      },
                    });
                    return (
                      <div
                        key={subagentId}
                        className="rounded-[5px] border p-3"
                        style={{ background: "var(--oc-bg2)", borderColor: "var(--oc-border)" }}
                      >
                        <div className="mb-2 text-[11px] font-semibold" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
                          {subagentId}
                        </div>
                        <FormGrid>
                          <Field label="Role kind" tooltip="Policy label used in the SDK Agent tool description. Explorer and worker are AnthroClaw policy hints, not custom runtimes.">
                            <select
                              value={role.kind ?? "custom"}
                              onChange={(e) => updateRole({ kind: e.target.value as "explorer" | "worker" | "custom" })}
                              className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
                            >
                              <option value="custom">custom</option>
                              <option value="explorer">explorer</option>
                              <option value="worker">worker</option>
                            </select>
                          </Field>
                          <Field label="Write policy" tooltip="Allow keeps all delegated tools, deny removes write-capable tools, claim_required keeps writes behind file ownership permission checks.">
                            <select
                              value={role.write_policy ?? "allow"}
                              onChange={(e) => updateRole({ write_policy: e.target.value as "allow" | "deny" | "claim_required" })}
                              className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
                            >
                              <option value="allow">allow</option>
                              <option value="deny">deny</option>
                              <option value="claim_required">claim_required</option>
                            </select>
                          </Field>
                          <Field label="Description" tooltip="Optional role note stored in config for operators and future policy UI.">
                            <input
                              value={role.description ?? ""}
                              onChange={(e) => updateRole({ description: e.target.value })}
                              placeholder="Role-specific operating note"
                              className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
                            />
                          </Field>
                        </FormGrid>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Section>
        </>
      ) : (
        /* Raw YAML editor */
        <div
          className="overflow-hidden rounded-md"
          style={{
            background: "var(--oc-bg1)",
            border: "1px solid var(--oc-border)",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{
              borderBottom: "1px solid var(--oc-border)",
              background: "var(--oc-bg2)",
            }}
          >
            <span className="text-[11.5px]" style={{ color: "var(--oc-text-dim)", fontFamily: "var(--oc-mono)" }}>
              agents/{agentId}/agent.yml
            </span>
            <span
              className="text-[10.5px]"
              style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
            >
              YAML &middot; {rawYaml.split("\n").length} lines
            </span>
          </div>
          <textarea
            value={rawYaml}
            onChange={(e) => {
              setRawYaml(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            className="h-[440px] w-full resize-none border-none p-3.5 outline-none"
            style={{
              background: "#07090d",
              color: "var(--color-foreground)",
              fontFamily: "var(--oc-mono)",
              fontSize: "12.5px",
              lineHeight: "20px",
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Config sub-components                                              */
/* ------------------------------------------------------------------ */

function Section({
  title,
  subtitle,
  icon,
  tooltip,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  tooltip?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md"
      style={{ background: "var(--oc-bg1)", border: "1px solid var(--oc-border)" }}
    >
      <div
        className="flex items-center justify-between gap-2.5 px-3.5 py-2.5"
        style={{ borderBottom: "1px solid var(--oc-border)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
            {title}
          </span>
          {tooltip && <Tip text={tooltip} />}
          {subtitle && (
            <span className="text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
              &middot; {subtitle}
            </span>
          )}
        </div>
        {action}
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3.5">{children}</div>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex cursor-help">
      <HelpCircle className="h-3 w-3" style={{ color: "var(--oc-text-muted)", opacity: 0.6 }} />
      <span
        className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden w-max max-w-[260px] -translate-x-1/2 rounded-md px-2.5 py-1.5 text-[11px] font-normal normal-case tracking-normal leading-[1.45] group-hover:block"
        style={{
          zIndex: 9999,
          background: "var(--oc-bg3)",
          border: "1px solid var(--oc-border)",
          color: "var(--color-foreground)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
      >
        {text}
      </span>
    </span>
  );
}

function Field({
  label,
  hint,
  tooltip,
  children,
}: {
  label: string;
  hint?: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        className="flex items-center text-[11px] font-medium uppercase tracking-[0.4px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {label}
        {tooltip && <Tip text={tooltip} />}
      </label>
      {children}
      {hint && (
        <p className="text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function ChannelRuleListEditor({
  rules,
  onChange,
  idLabel,
  idPlaceholder,
  promptPlaceholder,
  emptyHint,
}: {
  rules: Record<string, ChannelBehaviorRule> | undefined;
  onChange: (next: Record<string, ChannelBehaviorRule>) => void;
  idLabel: string;
  idPlaceholder: string;
  promptPlaceholder: string;
  emptyHint: string;
}) {
  const entries = Object.entries(rules ?? {});

  const renameRule = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    const next: Record<string, ChannelBehaviorRule> = {};
    for (const [k, v] of Object.entries(rules ?? {})) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
  };

  const updateRule = (key: string, rule: ChannelBehaviorRule) => {
    onChange({ ...(rules ?? {}), [key]: rule });
  };

  const removeRule = (key: string) => {
    const next = { ...(rules ?? {}) };
    delete next[key];
    onChange(next);
  };

  const addRule = () => {
    if ("" in (rules ?? {})) return;
    onChange({ ...(rules ?? {}), "": { prompt: "" } });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {entries.length === 0 && (
        <p className="text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
          {emptyHint}
        </p>
      )}
      {entries.map(([key, rule], idx) => (
        <ChannelRuleRow
          key={`${idx}-${key}`}
          ruleKey={key}
          rule={rule}
          idLabel={idLabel}
          idPlaceholder={idPlaceholder}
          promptPlaceholder={promptPlaceholder}
          onRenameKey={(newKey) => renameRule(key, newKey)}
          onChangeRule={(next) => updateRule(key, next)}
          onRemove={() => removeRule(key)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRule}
        className="self-start"
      >
        <Plus className="mr-1 h-3 w-3" /> Add rule
      </Button>
    </div>
  );
}

function ChannelRuleRow({
  ruleKey,
  rule,
  idLabel,
  idPlaceholder,
  promptPlaceholder,
  onRenameKey,
  onChangeRule,
  onRemove,
}: {
  ruleKey: string;
  rule: ChannelBehaviorRule;
  idLabel: string;
  idPlaceholder: string;
  promptPlaceholder: string;
  onRenameKey: (newKey: string) => void;
  onChangeRule: (next: ChannelBehaviorRule) => void;
  onRemove: () => void;
}) {
  // Local id buffer commits on blur to avoid a parent re-render between every
  // keystroke (which would steal cursor focus when the record key is renamed).
  const [localId, setLocalId] = useState(ruleKey);
  useEffect(() => {
    setLocalId(ruleKey);
  }, [ruleKey]);

  const commitId = () => {
    const trimmed = localId.trim();
    if (trimmed !== ruleKey) onRenameKey(trimmed);
  };

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 rounded-[6px] border p-2"
      style={{
        background: "var(--oc-bg2)",
        borderColor: "var(--oc-border)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          value={localId}
          onChange={(e) => setLocalId(e.target.value)}
          onBlur={commitId}
          placeholder={idPlaceholder}
          aria-label={idLabel}
          className="h-7 min-w-0 flex-1 rounded-[5px] border px-2 font-mono text-[11px] outline-none"
          style={{
            background: "var(--oc-bg3)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
          }}
        />
        <select
          value={rule.reply_to_mode ?? ""}
          onChange={(e) =>
            onChangeRule({
              ...rule,
              reply_to_mode: (e.target.value || undefined) as ReplyToMode | undefined,
            })
          }
          aria-label="Reply mode override"
          className="h-7 cursor-pointer rounded-[5px] border px-2 text-[11px]"
          style={{
            background: "var(--oc-bg3)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
          }}
        >
          <option value="">inherit reply mode</option>
          <option value="always">always reply</option>
          <option value="incoming_reply_only">reply only to replies</option>
          <option value="never">never thread</option>
        </select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label="Remove rule"
          className="h-7 w-7 p-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <textarea
        value={rule.prompt ?? ""}
        onChange={(e) => onChangeRule({ ...rule, prompt: e.target.value })}
        placeholder={promptPlaceholder}
        rows={3}
        className="min-h-[60px] w-full resize-y rounded-[5px] border px-2 py-1.5 text-xs outline-none"
        style={{
          background: "var(--oc-bg3)",
          borderColor: "var(--oc-border)",
          color: "var(--color-foreground)",
        }}
      />
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  tooltip,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tooltip?: string;
}) {
  return (
    <label
      className="flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-[5px] border px-2.5 py-1.5 text-xs"
      style={{
        background: "var(--oc-bg2)",
        borderColor: "var(--oc-border)",
        color: "var(--color-foreground)",
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{label}</span>
        {tooltip && <Tip text={tooltip} />}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--oc-accent)" }}
      />
    </label>
  );
}

function ExternalMcpPreflightResult({ state }: { state: ExternalMcpPreflightState }) {
  if (state.loading) {
    return (
      <div className="mt-3 rounded-[5px] border px-3 py-2 text-[11.5px]" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg3)", color: "var(--oc-text-muted)" }}>
        Checking MCP command, env, tools, and transport risk...
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="mt-3 rounded-[5px] border px-3 py-2 text-[11.5px]" style={{ borderColor: "rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.08)", color: "var(--oc-red)" }}>
        {state.error}
      </div>
    );
  }

  const server = state.server;
  if (!server) return null;
  const approvalColor = server.approvalStatus === "approved"
    ? "var(--oc-green)"
    : server.approvalStatus === "blocked"
      ? "var(--oc-red)"
      : "var(--oc-yellow)";

  return (
    <div className="mt-3 rounded-[5px] border px-3 py-2.5" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg3)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.4px]" style={{ color: approvalColor, background: "var(--oc-bg2)" }}>
          {server.approvalStatus.replace("_", " ")}
        </span>
        <span className="text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
          network:{server.networkRisk} / fs:{server.filesystemRisk} / {server.packageSource}
        </span>
      </div>
      {server.reasons.length > 0 && (
        <div className="mt-2 space-y-1">
          {server.reasons.slice(0, 3).map((reason) => (
            <div key={reason} className="text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
              {reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoutesTable({
  routes,
  allowlist,
  onChange,
  onAllowlistChange,
}: {
  routes: AgentConfig["routes"];
  allowlist: Record<string, string[]>;
  onChange: (rs: NonNullable<AgentConfig["routes"]>) => void;
  onAllowlistChange: (al: Record<string, string[]>) => void;
}) {
  if (!routes) return null;
  const del = (i: number) => onChange(routes.filter((_, j) => j !== i));
  const edit = (i: number, patch: Partial<(typeof routes)[0]>) =>
    onChange(routes.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-0">
      {routes.map((r, i) => {
        const isLast = i === routes.length - 1;
        const channelIds = (allowlist[r.channel] ?? []).join(", ");
        return (
          <div
            key={i}
            className="flex flex-col gap-2.5 px-3 py-3"
            style={{
              borderBottom: isLast ? "none" : "1px solid var(--oc-border)",
            }}
          >
            <div className="flex items-center gap-2">
              <select
                value={r.channel}
                onChange={(e) => edit(i, { channel: e.target.value })}
                className="h-7 cursor-pointer rounded-[5px] border px-1.5 text-[11.5px] font-medium"
                style={{
                  background: "var(--oc-bg3)",
                  borderColor: "var(--oc-border)",
                  color: "var(--color-foreground)",
                }}
              >
                <option value="telegram">Telegram</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
              <select
                value={r.scope}
                onChange={(e) => edit(i, { scope: e.target.value })}
                className="h-7 cursor-pointer rounded-[5px] border px-1.5 text-[11.5px]"
                style={{
                  background: "var(--oc-bg3)",
                  borderColor: "var(--oc-border)",
                  color: "var(--color-foreground)",
                }}
              >
                <option value="dm">DM only</option>
                <option value="group">Groups only</option>
                <option value="any">DM + Groups</option>
              </select>
              {r.scope !== "dm" && (
                <label className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--color-foreground)" }}>
                  <input
                    type="checkbox"
                    checked={r.mentionOnly ?? false}
                    onChange={(e) => edit(i, { mentionOnly: e.target.checked })}
                    style={{ accentColor: "var(--oc-accent)" }}
                  />
                  @mention only
                </label>
              )}
              <button
                onClick={() => del(i)}
                className="ml-auto inline-flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--oc-bg3)]"
                style={{ color: "var(--oc-text-dim)" }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3 w-3" style={{ color: "var(--oc-text-muted)" }} />
                <span className="text-[10px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
                  Allowed IDs
                </span>
              </div>
              <input
                value={channelIds}
                onChange={(e) =>
                  onAllowlistChange({
                    ...allowlist,
                    [r.channel]: e.target.value
                      ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                      : [],
                  })
                }
                placeholder="* for everyone, or comma-separated user IDs"
                className="h-6 flex-1 rounded-[5px] border px-1.5 text-[11px] outline-none"
                style={{
                  background: "var(--oc-bg3)",
                  borderColor: "var(--oc-border)",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--oc-mono)",
                }}
              />
            </div>
          </div>
        );
      })}
      {routes.length === 0 && (
        <div className="p-5 text-center text-xs" style={{ color: "var(--oc-text-muted)" }}>
          No routes. This agent won&apos;t receive any messages.
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Memory Tab                                                        */
/* ------------------------------------------------------------------ */

function MemoryReviewTab({ serverId, agentId }: { serverId: string; agentId: string }) {
  const [status, setStatus] = useState<MemoryReviewStatus | "all">("pending");
  const [source, setSource] = useState("all");
  const [entries, setEntries] = useState<MemoryEntryRecord[]>([]);
  const [doctor, setDoctor] = useState<MemoryDoctorReport | null>(null);
  const [influence, setInfluence] = useState<MemoryInfluenceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMemory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "80" });
      if (status !== "all") params.set("reviewStatus", status);
      if (source !== "all") params.set("source", source);
      const [entriesRes, doctorRes, influenceRes] = await Promise.all([
        fetch(`/api/fleet/${serverId}/agents/${encodeURIComponent(agentId)}/memory?${params.toString()}`),
        fetch(`/api/fleet/${serverId}/agents/${encodeURIComponent(agentId)}/memory/doctor?limit=1000`),
        fetch(`/api/fleet/${serverId}/agents/${encodeURIComponent(agentId)}/memory/influence?limit=12`),
      ]);
      if (!entriesRes.ok) throw new Error(`entries ${entriesRes.status}`);
      if (!doctorRes.ok) throw new Error(`doctor ${doctorRes.status}`);
      if (!influenceRes.ok) throw new Error(`influence ${influenceRes.status}`);
      const entriesJson = await entriesRes.json() as { entries?: MemoryEntryRecord[] };
      const doctorJson = await doctorRes.json() as MemoryDoctorReport;
      const influenceJson = await influenceRes.json() as { events?: MemoryInfluenceEvent[] };
      setEntries(entriesJson.entries ?? []);
      setDoctor(doctorJson);
      setInfluence(influenceJson.events ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memory review");
    } finally {
      setLoading(false);
    }
  }, [agentId, serverId, source, status]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  const updateReview = async (entryId: string, reviewStatus: MemoryReviewStatus, reviewNote?: string) => {
    setSavingId(entryId);
    setError(null);
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents/${encodeURIComponent(agentId)}/memory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, reviewStatus, reviewNote }),
      });
      if (!res.ok) throw new Error(`review ${res.status}`);
      await loadMemory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update memory review");
    } finally {
      setSavingId(null);
    }
  };

  const reviewEntry = (entryId: string, reviewStatus: MemoryReviewStatus) => {
    const note = window.prompt(
      reviewStatus === "approved" ? "Approval note (optional)" : "Rejection reason (optional)",
    );
    if (note === null) return;
    void updateReview(entryId, reviewStatus, note?.trim() || undefined);
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--color-foreground)" }}>
            Memory review
          </h2>
          <p className="mt-1 text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
            Provenance, review status, and doctor findings for this agent&apos;s long-term memory.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className="h-8 cursor-pointer rounded-[5px] border px-2 text-xs"
            style={{
              background: "var(--oc-bg2)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
            }}
          >
            <option value="all">All sources</option>
            <option value="post_run_candidate">Post-run candidates</option>
            <option value="local_note_proposal">Local note proposals</option>
            <option value="memory_write">Memory writes</option>
            <option value="memory_wiki">Memory wiki</option>
            <option value="dreaming">Dreaming</option>
            <option value="index">Indexed files</option>
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as MemoryReviewStatus | "all")}
            className="h-8 cursor-pointer rounded-[5px] border px-2 text-xs"
            style={{
              background: "var(--oc-bg2)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
            }}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <Button variant="outline" size="sm" onClick={loadMemory} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md border px-3 py-2 text-[12px]"
          style={{
            background: "rgba(248,113,113,0.1)",
            borderColor: "rgba(248,113,113,0.35)",
            color: "var(--oc-red)",
          }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[1.35fr_1fr]">
        <div className="rounded-md border" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}>
          <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5" style={{ borderColor: "var(--oc-border)" }}>
            <div className="flex items-center gap-2">
              <Database className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />
              <span className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                Entries
              </span>
            </div>
            <span className="text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
              {entries.length} shown
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--oc-border)" }}>
            {loading ? (
              <MemorySkeletonRows />
            ) : entries.length === 0 ? (
              <div className="p-6 text-center text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
                No memory entries match this filter.
              </div>
            ) : entries.map((entry) => (
              <MemoryEntryRow
                key={entry.id}
                serverId={serverId}
                entry={entry}
                saving={savingId === entry.id}
                onApprove={() => reviewEntry(entry.id, "approved")}
                onReject={() => reviewEntry(entry.id, "rejected")}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-md border" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}>
            <div className="flex items-center gap-2 border-b px-3.5 py-2.5" style={{ borderColor: "var(--oc-border)" }}>
              <AlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--oc-yellow)" }} />
              <span className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                Doctor
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              <MemoryDoctorMetric label="Entries" value={doctor?.entriesChecked ?? 0} />
              <MemoryDoctorMetric label="Chunks" value={doctor?.chunksChecked ?? 0} />
              <MemoryDoctorMetric label="Duplicates" value={doctor?.summary.duplicateContent ?? 0} />
              <MemoryDoctorMetric label="Conflicts" value={doctor?.summary.conflictingFacts ?? 0} />
            </div>
          </div>

          <div className="rounded-md border" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}>
            <div className="border-b px-3.5 py-2.5 text-[13px] font-semibold" style={{ borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}>
              Recent findings
            </div>
            <div className="divide-y" style={{ borderColor: "var(--oc-border)" }}>
              {!doctor || doctor.issues.length === 0 ? (
                <div className="p-5 text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
                  No doctor findings for the current memory set.
                </div>
              ) : doctor.issues.slice(0, 8).map((issue, index) => (
                <div key={`${issue.kind}-${index}`} className="px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-medium" style={{ color: "var(--color-foreground)" }}>
                      {memoryIssueLabel(issue.kind)}
                    </span>
                    <span className="rounded px-1.5 py-px text-[10px]" style={memoryIssueStyle(issue.severity)}>
                      {issue.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
                    {issue.message}
                  </p>
                  <div className="mt-2 truncate text-[10.5px]" style={{ color: "var(--oc-text-dim)", fontFamily: "var(--oc-mono)" }}>
                    {issue.paths.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}>
            <div className="border-b px-3.5 py-2.5 text-[13px] font-semibold" style={{ borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}>
              Recent influence
            </div>
            <div className="divide-y" style={{ borderColor: "var(--oc-border)" }}>
              {influence.length === 0 ? (
                <div className="p-5 text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
                  No recorded memory influence yet.
                </div>
              ) : influence.map((event) => (
                <MemoryInfluenceRow
                  key={event.id ?? `${event.source}-${event.timestamp}`}
                  serverId={serverId}
                  event={event}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryEntryRow({
  serverId,
  entry,
  saving,
  onApprove,
  onReject,
}: {
  serverId: string;
  entry: MemoryEntryRecord;
  saving: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12.5px] font-medium" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
              {entry.path}
            </span>
            <span className="shrink-0 rounded px-1.5 py-px text-[10px]" style={memoryStatusStyle(entry.reviewStatus)}>
              {entry.reviewStatus}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
            <span>{entry.source}</span>
            <span>{formatRuntimeTime(entry.updatedAt)}</span>
            {entry.provenance.runId && (
              <span className="inline-flex items-center gap-1">
                run {shortRuntimeId(entry.provenance.runId, 10)}
                <RuntimeDiagnosticsLink serverId={serverId} runId={entry.provenance.runId} />
              </span>
            )}
            {entry.provenance.sessionKey && <span>{shortRuntimeId(entry.provenance.sessionKey, 28)}</span>}
          </div>
          {entry.reviewNote && (
            <p className="mt-1 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
              {entry.reviewNote}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={saving || entry.reviewStatus === "approved"}
            onClick={onApprove}
            title="Approve memory entry"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={saving || entry.reviewStatus === "rejected"}
            onClick={onReject}
            title="Reject memory entry"
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

function MemoryDoctorMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[5px] border px-2.5 py-2" style={{ background: "var(--oc-bg2)", borderColor: "var(--oc-border)" }}>
      <div className="text-[10px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
        {value}
      </div>
    </div>
  );
}

function MemoryInfluenceRow({ serverId, event }: { serverId: string; event: MemoryInfluenceEvent }) {
  const firstRef = event.refs[0];
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded px-1.5 py-px text-[10px]" style={memoryInfluenceStyle(event.source)}>
          {event.source}
        </span>
        <div className="flex items-center gap-1.5">
          {event.runId && <RuntimeDiagnosticsLink serverId={serverId} runId={event.runId} />}
          {event.timestamp && (
            <span className="text-[10.5px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
              {formatRuntimeTime(event.timestamp)}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 truncate text-[11.5px]" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
        {firstRef ? `${firstRef.path}${firstRef.startLine !== undefined ? `#L${firstRef.startLine}` : ""}` : "No refs"}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10.5px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
        {event.query && <span>query {shortRuntimeId(event.query, 22)}</span>}
        {event.runId && <span>run {shortRuntimeId(event.runId, 10)}</span>}
        <span>{event.refs.length} refs</span>
      </div>
    </div>
  );
}

function MemorySkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((item) => (
        <div key={item} className="px-3.5 py-3">
          <div className="h-3.5 w-2/3 animate-pulse rounded" style={{ background: "var(--oc-bg3)" }} />
          <div className="mt-2 h-2.5 w-1/2 animate-pulse rounded" style={{ background: "var(--oc-bg3)" }} />
        </div>
      ))}
    </>
  );
}

function memoryStatusStyle(status: MemoryReviewStatus): React.CSSProperties {
  if (status === "approved") {
    return {
      background: "rgba(74,222,128,0.13)",
      border: "1px solid rgba(74,222,128,0.32)",
      color: "var(--oc-green)",
    };
  }
  if (status === "rejected") {
    return {
      background: "rgba(248,113,113,0.12)",
      border: "1px solid rgba(248,113,113,0.32)",
      color: "var(--oc-red)",
    };
  }
  return {
    background: "rgba(250,204,21,0.12)",
    border: "1px solid rgba(250,204,21,0.32)",
    color: "var(--oc-yellow)",
  };
}

function memoryIssueStyle(severity: MemoryDoctorIssue["severity"]): React.CSSProperties {
  if (severity === "error") {
    return { background: "rgba(248,113,113,0.12)", color: "var(--oc-red)" };
  }
  if (severity === "warn") {
    return { background: "rgba(250,204,21,0.12)", color: "var(--oc-yellow)" };
  }
  return { background: "var(--oc-bg3)", color: "var(--oc-text-muted)" };
}

function memoryIssueLabel(kind: MemoryDoctorIssue["kind"]): string {
  switch (kind) {
    case "duplicate_content":
      return "Duplicate content";
    case "stale_entry":
      return "Stale entry";
    case "oversized_file":
      return "Oversized file";
    case "conflicting_fact":
      return "Conflicting fact";
  }
}

function memoryInfluenceStyle(source: MemoryInfluenceEvent["source"]): React.CSSProperties {
  if (source === "memory_search") {
    return { background: "var(--oc-accent-soft)", color: "var(--oc-accent)" };
  }
  return { background: "var(--oc-bg3)", color: "var(--oc-text-muted)" };
}

/* ------------------------------------------------------------------ */
/*  Runs Tab                                                           */
/* ------------------------------------------------------------------ */

function RunsTab({ serverId, agentId }: { serverId: string; agentId: string }) {
  const [runs, setRuns] = useState<AgentRunRecord[]>([]);
  const [decisions, setDecisions] = useState<RouteDecisionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [runStatus, setRunStatus] = useState<"all" | AgentRunStatus>("all");
  const [outcome, setOutcome] = useState("all");

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const statusQuery = runStatus === "all" ? "" : `&status=${encodeURIComponent(runStatus)}`;
      const outcomeQuery = outcome === "all" ? "" : `&outcome=${encodeURIComponent(outcome)}`;
      const [runsRes, decisionsRes] = await Promise.all([
        fetch(`/api/fleet/${serverId}/agents/${encodeURIComponent(agentId)}/runs?limit=50${statusQuery}`),
        fetch(`/api/fleet/${serverId}/routing/decisions?agentId=${encodeURIComponent(agentId)}&limit=50${outcomeQuery}`),
      ]);
      if (runsRes.ok) {
        const data = await runsRes.json();
        setRuns(Array.isArray(data.runs) ? data.runs as AgentRunRecord[] : []);
      }
      if (decisionsRes.ok) {
        const data = await decisionsRes.json();
        setDecisions(Array.isArray(data) ? data as RouteDecisionRecord[] : []);
      }
    } finally {
      setLoading(false);
    }
  }, [agentId, outcome, runStatus, serverId]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const decisionsById = new Map(decisions.map((decision) => [decision.id, decision]));

  return (
    <div className="flex max-w-[1180px] flex-col gap-3.5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold" style={{ color: "var(--color-foreground)" }}>
            Runtime observability
          </h2>
          <p className="mt-1 text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
            Native SDK run records and gateway route decisions for this agent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={runStatus}
            onChange={(e) => setRunStatus(e.target.value as "all" | AgentRunStatus)}
            className="h-8 cursor-pointer rounded-[5px] border px-2 text-xs"
            style={{
              background: "var(--oc-bg3)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
            }}
          >
            <option value="all">all runs</option>
            <option value="running">running</option>
            <option value="succeeded">succeeded</option>
            <option value="failed">failed</option>
            <option value="interrupted">interrupted</option>
          </select>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="h-8 cursor-pointer rounded-[5px] border px-2 text-xs"
            style={{
              background: "var(--oc-bg3)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
            }}
          >
            <option value="all">all routes</option>
            <option value="dispatched">dispatched</option>
            <option value="no_route">no_route</option>
            <option value="access_denied">access_denied</option>
            <option value="rate_limited">rate_limited</option>
            <option value="queue_queued">queue_queued</option>
            <option value="queue_skipped">queue_skipped</option>
          </select>
          <Button variant="outline" size="sm" onClick={fetchRuns} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <section
          className="rounded-md border"
          style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}
        >
          <div
            className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5"
            style={{ borderColor: "var(--oc-border)" }}
          >
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />
              <span className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                SDK runs
              </span>
            </div>
            <RuntimePill>{runs.length}</RuntimePill>
          </div>
          <div className="flex flex-col divide-y" style={{ borderColor: "var(--oc-border)" }}>
            {runs.length === 0 ? (
              <EmptyRuntimeState text="No SDK runs recorded for this filter." />
            ) : (
              runs.map((run) => (
                <RunRow
                  key={run.runId}
                  run={run}
                  decision={run.routeDecisionId ? decisionsById.get(run.routeDecisionId) : undefined}
                  serverId={serverId}
                  agentId={agentId}
                />
              ))
            )}
          </div>
        </section>

        <section
          className="rounded-md border"
          style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}
        >
          <div
            className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5"
            style={{ borderColor: "var(--oc-border)" }}
          >
            <div className="flex items-center gap-2">
              <List className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />
              <span className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                Route decisions
              </span>
            </div>
            <RuntimePill>{decisions.length}</RuntimePill>
          </div>
          <div className="flex max-h-[760px] flex-col overflow-auto">
            {decisions.length === 0 ? (
              <EmptyRuntimeState text="No route decisions recorded for this filter." />
            ) : (
              decisions.map((decision) => (
                <RouteDecisionRow key={decision.id} decision={decision} />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function RunRow({
  run,
  decision,
  serverId,
  agentId,
}: {
  run: AgentRunRecord;
  decision?: RouteDecisionRecord;
  serverId: string;
  agentId: string;
}) {
  const tokens = (run.usage?.inputTokens ?? 0) + (run.usage?.outputTokens ?? 0);
  const duration = run.usage?.durationMs ?? (run.completedAt ? run.completedAt - run.startedAt : Date.now() - run.startedAt);

  return (
    <div className="flex flex-col gap-2 px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <RuntimePill tone={run.status === "succeeded" ? "done" : run.status === "running" ? "running" : "bad"}>
              {run.status}
            </RuntimePill>
            <span
              className="truncate text-[12px] font-medium"
              title={run.runId}
              style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
            >
              {shortRuntimeId(run.runId, 18)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <RuntimePill>{run.source}/{run.channel}</RuntimePill>
            {run.model && <RuntimePill>{run.model}</RuntimePill>}
            {decision && <RuntimePill tone="done">{decision.outcome}</RuntimePill>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <RuntimeDiagnosticsLink serverId={serverId} runId={run.runId} />
          <Link href={`/fleet/${serverId}/chat/${agentId}`} className="shrink-0">
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]">
              <MessageSquare className="h-3 w-3" />
              Chat
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-2 text-[10.5px] sm:grid-cols-4">
        <RuntimeMeta label="started" value={formatRuntimeTime(run.startedAt)} />
        <RuntimeMeta label="duration" value={formatRuntimeDuration(duration)} />
        <RuntimeMeta label="tokens" value={tokens > 0 ? String(tokens) : "unknown"} />
        <RuntimeMeta label="session" value={shortRuntimeId(run.sdkSessionId ?? run.sessionKey, 16)} title={run.sdkSessionId ?? run.sessionKey} />
      </div>

      {(run.usage?.cacheReadTokens || run.usage?.totalCostUsd !== undefined || run.error) && (
        <div className="flex flex-wrap gap-2 text-[10.5px]">
          {run.usage?.cacheReadTokens !== undefined && (
            <RuntimePill>cache {run.usage.cacheReadTokens}</RuntimePill>
          )}
          {run.usage?.totalCostUsd !== undefined && (
            <RuntimePill>${run.usage.totalCostUsd.toFixed(4)}</RuntimePill>
          )}
          {run.error && <RuntimePill tone="bad">{run.error}</RuntimePill>}
        </div>
      )}
    </div>
  );
}

function RouteDecisionRow({ decision }: { decision: RouteDecisionRecord }) {
  return (
    <div
      className="flex flex-col gap-2 border-b px-3.5 py-3 last:border-b-0"
      style={{ borderColor: "var(--oc-border)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <RuntimePill tone={decision.outcome === "dispatched" ? "done" : "default"}>
              {decision.outcome}
            </RuntimePill>
            <span
              className="truncate text-[11.5px]"
              title={decision.id}
              style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
            >
              {shortRuntimeId(decision.id, 16)}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
            {decision.channel}/{decision.chatType} · peer {decision.peerId}
          </p>
        </div>
        <RuntimePill tone={decision.accessAllowed === false ? "bad" : "default"}>
          {decision.accessAllowed === undefined ? "access ?" : decision.accessAllowed ? "allowed" : "denied"}
        </RuntimePill>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10.5px]">
        <RuntimeMeta label="winner" value={decision.winnerAgentId ?? "none"} />
        <RuntimeMeta label="candidates" value={String(decision.candidates.length)} />
        {decision.timestamp && <RuntimeMeta label="time" value={formatRuntimeTime(decision.timestamp)} />}
        {decision.queueAction && <RuntimeMeta label="queue" value={decision.queueAction} />}
      </div>
      {decision.candidates.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {decision.candidates.slice(0, 4).map((candidate) => (
            <RuntimePill key={`${decision.id}-${candidate.agentId}-${candidate.priority}`}>
              {candidate.agentId} p{candidate.priority}
            </RuntimePill>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyRuntimeState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <Monitor className="h-5 w-5" style={{ color: "var(--oc-text-muted)" }} />
      <p className="text-xs" style={{ color: "var(--oc-text-muted)" }}>
        {text}
      </p>
    </div>
  );
}

function RuntimePill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "running" | "done" | "bad";
}) {
  const color = tone === "running"
    ? "var(--oc-yellow)"
    : tone === "done"
      ? "var(--oc-green)"
      : tone === "bad"
        ? "var(--oc-red)"
        : "var(--oc-text-muted)";

  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded border px-1.5 py-px text-[10px]"
      style={{
        borderColor: "var(--oc-border)",
        color,
        fontFamily: "var(--oc-mono)",
      }}
    >
      {children}
    </span>
  );
}

function RuntimeMeta({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <div className="uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
        {label}
      </div>
      <div
        className="truncate"
        title={title ?? value}
        style={{ color: "var(--oc-text-dim)", fontFamily: "var(--oc-mono)" }}
      >
        {value}
      </div>
    </div>
  );
}

function runtimeDiagnosticsUrl(serverId: string, runId: string): string {
  const params = new URLSearchParams({
    includeLogs: "true",
    runId,
    diagnosticEventLimit: "300",
    routeDecisionLimit: "25",
  });
  return `/api/fleet/${serverId}/diagnostics/export?${params.toString()}`;
}

function RuntimeDiagnosticsLink({ serverId, runId }: { serverId: string; runId: string }) {
  return (
    <a
      href={runtimeDiagnosticsUrl(serverId, runId)}
      download={`anthroclaw-run-${runId}-diagnostics.json`}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border"
      style={{
        borderColor: "var(--oc-border)",
        color: "var(--oc-text-muted)",
        background: "var(--oc-bg2)",
      }}
      title="Download diagnostics for this run"
    >
      <Download className="h-3.5 w-3.5" />
    </a>
  );
}

function shortRuntimeId(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 3))}...`;
}

function formatRuntimeTime(value: number): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRuntimeDuration(value: number): string {
  const safe = Math.max(0, value);
  if (safe < 1000) return `${safe}ms`;
  const seconds = Math.floor(safe / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

/* ------------------------------------------------------------------ */
/*  Files Tab                                                          */
/* ------------------------------------------------------------------ */

function FilesTab({ serverId, agentId }: { serverId: string; agentId: string }) {
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents/${agentId}/files`);
      if (res.ok) {
        const d = await res.json();
        const list: AgentFile[] = Array.isArray(d) ? d : d.files ?? [];
        setFiles(list);
        if (list.length > 0 && !selected) {
          setSelected(list[0].name);
        }
      }
    } catch {
      // silently fail
    }
  }, [serverId, agentId, selected]);

  const fetchContent = useCallback(async () => {
    if (!selected) return;
    try {
      const res = await fetch(
        `/api/fleet/${serverId}/agents/${agentId}/files/${encodeURIComponent(selected)}`,
      );
      if (res.ok) {
        const d = await res.json();
        setContent(d.content ?? "");
        setDirty(false);
      }
    } catch {
      // silently fail
    }
  }, [serverId, agentId, selected]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const handleSave = async () => {
    if (!selected || !dirty) return;
    setSaving(true);
    try {
      await fetch(
        `/api/fleet/${serverId}/agents/${agentId}/files/${encodeURIComponent(selected)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      setDirty(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const handleNewFile = async () => {
    if (!newFileName) return;
    try {
      await fetch(
        `/api/fleet/${serverId}/agents/${agentId}/files/${encodeURIComponent(newFileName)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "" }),
        },
      );
      setNewFileOpen(false);
      setNewFileName("");
      setSelected(newFileName);
      await fetchFiles();
    } catch {
      // silently fail
    }
  };

  const handleDeleteFile = async () => {
    if (!selected || selected === "CLAUDE.md") return;
    try {
      await fetch(
        `/api/fleet/${serverId}/agents/${agentId}/files/${encodeURIComponent(selected)}`,
        { method: "DELETE" },
      );
      setSelected("");
      await fetchFiles();
    } catch {
      // silently fail
    }
  };

  const file = files.find((f) => f.name === selected);

  return (
    <div className="flex h-full" style={{ minHeight: 520 }}>
      {/* File list */}
      <div
        className="flex w-[260px] flex-col"
        style={{
          borderRight: "1px solid var(--oc-border)",
          background: "var(--oc-bg1)",
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-2.5"
          style={{ borderBottom: "1px solid var(--oc-border)" }}
        >
          <span
            className="text-[11px] uppercase tracking-[0.5px]"
            style={{ color: "var(--oc-text-muted)" }}
          >
            Files ({files.length})
          </span>
          <button
            onClick={() => setNewFileOpen(true)}
            className="inline-flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--oc-bg3)]"
            style={{ color: "var(--oc-text-dim)" }}
            title="New file"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-1">
          {files.map((f) => {
            const active = f.name === selected;
            return (
              <button
                key={f.name}
                onClick={() => setSelected(f.name)}
                className="mb-px flex w-full flex-col gap-0.5 rounded-[5px] p-2 text-left"
                style={{
                  background: active ? "var(--oc-accent-soft)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <FileText
                    className="h-3 w-3"
                    style={{ color: active ? "var(--oc-accent)" : "var(--oc-text-muted)" }}
                  />
                  <span
                    className="flex-1 truncate text-xs"
                    style={{
                      color: active ? "var(--oc-accent)" : "var(--color-foreground)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    {f.name}
                  </span>
                  {f.special === "system" && (
                    <span
                      className="rounded px-1 py-px text-[10px] font-medium"
                      style={{
                        background: "var(--oc-accent-soft)",
                        color: "var(--oc-accent)",
                        border: "1px solid var(--oc-accent-ring)",
                      }}
                    >
                      PROMPT
                    </span>
                  )}
                </div>
                <div
                  className="flex gap-2 text-[10.5px]"
                  style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
                >
                  <span>{(f.size / 1024).toFixed(1)}k</span>
                  <span>&middot;</span>
                  <span>
                    {new Date(f.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex items-center justify-between gap-2.5 px-3.5 py-2.5"
          style={{
            borderBottom: "1px solid var(--oc-border)",
            background: "var(--oc-bg1)",
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-3.5 w-3.5" style={{ color: "var(--oc-text-muted)" }} />
            <span
              className="text-[13px]"
              style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
            >
              {selected || "---"}
            </span>
            {dirty && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--oc-yellow)" }}
              />
            )}
            <span
              className="text-[11px]"
              style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
            >
              &middot; {content.split("\n").length} lines &middot; {content.length} chars
            </span>
          </div>
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigator.clipboard.writeText(content)}
            >
              <Copy className="h-3 w-3" />
              Copy
            </Button>
            {file?.special !== "system" && selected && (
              <Button variant="ghost" size="sm" onClick={handleDeleteFile}>
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            )}
            <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
              <Save className="h-3 w-3" />
              Save (Cmd+S)
            </Button>
          </div>
        </div>
        <div className="relative flex-1 overflow-hidden" style={{ background: "#07090d" }}>
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            className="h-full w-full resize-none border-none p-3.5 outline-none"
            style={{
              background: "transparent",
              color: "var(--color-foreground)",
              fontFamily: "var(--oc-mono)",
              fontSize: "13px",
              lineHeight: "22px",
            }}
          />
        </div>
        <div
          className="flex items-center justify-between px-3.5 py-1.5 text-[10.5px]"
          style={{
            borderTop: "1px solid var(--oc-border)",
            background: "var(--oc-bg2)",
            color: "var(--oc-text-muted)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          <span>UTF-8 &middot; Markdown &middot; LF</span>
          <span>
            agents/{agentId}/{selected}
          </span>
        </div>
      </div>

      {/* New file dialog */}
      <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
        <DialogContent
          className="sm:max-w-[400px]"
          style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border-mid)" }}
        >
          <DialogHeader>
            <DialogTitle>New file</DialogTitle>
            <DialogDescription>Enter a filename for the new file.</DialogDescription>
          </DialogHeader>
          <input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="e.g. instructions.md"
            className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
            style={{
              background: "var(--oc-bg3)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
              fontFamily: "var(--oc-mono)",
            }}
            onKeyDown={(e) => e.key === "Enter" && handleNewFile()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFileOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!newFileName} onClick={handleNewFile}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skills Tab                                                         */
/* ------------------------------------------------------------------ */

function SkillsTab({ serverId, agentId }: { serverId: string; agentId: string }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitName, setGitName] = useState("");
  const [viewing, setViewing] = useState<SkillInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents/${agentId}/skills`);
      if (res.ok) {
        const d = await res.json();
        setSkills(Array.isArray(d) ? d : d.skills ?? []);
      }
    } catch {
      // silently fail
    }
  }, [serverId, agentId]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      await fetch(`/api/fleet/${serverId}/agents/${agentId}/skills/upload`, {
        method: "POST",
        body: formData,
      });
      setUploadOpen(false);
      await fetchSkills();
    } catch {
      // silently fail
    }
  };

  const handleGitClone = async () => {
    if (!gitUrl) return;
    try {
      await fetch(`/api/fleet/${serverId}/agents/${agentId}/skills/git`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: gitUrl,
          branch: gitBranch,
          name: gitName || undefined,
        }),
      });
      setGitOpen(false);
      setGitUrl("");
      await fetchSkills();
    } catch {
      // silently fail
    }
  };

  const handleSkillAttachment = async (name: string, attached: boolean) => {
    try {
      await fetch(`/api/fleet/${serverId}/agents/${agentId}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: attached ? "detach" : "attach",
          skillName: name,
        }),
      });
      await fetchSkills();
    } catch {
      // silently fail
    }
  };

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "var(--oc-text-muted)" }}>
          {skills.filter((skill) => skill.attached).length} of {skills.length} catalog skills attached to{" "}
          <span style={{ fontFamily: "var(--oc-mono)", color: "var(--oc-text-dim)" }}>
            agents/{agentId}/.claude/skills/
          </span>
        </span>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setGitOpen(true)}>
            <GitBranch className="h-3 w-3" />
            Clone from git
          </Button>
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-3 w-3" />
            Upload skill
          </Button>
        </div>
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {skills.map((s) => (
          <div
            key={s.name}
            className="flex flex-col gap-2.5 rounded-md p-3.5 transition-colors"
            style={{
              background: "var(--oc-bg1)",
              border: "1px solid var(--oc-border)",
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 overflow-hidden">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px]"
                  style={{ background: "var(--oc-accent-soft)", color: "var(--oc-accent)" }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <span
                  className="truncate text-[13px] font-semibold"
                  style={{
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                  }}
                >
                  {s.name}
                </span>
              </div>
            </div>
            <p
              className="text-[11.5px] leading-relaxed"
              style={{ color: "var(--oc-text-dim)", minHeight: 44 }}
            >
              {s.description}
            </p>
            <div className="flex flex-wrap gap-1">
              <span
                className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
                style={{
                  background: s.attached ? "var(--oc-accent-soft)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${s.attached ? "var(--oc-accent-ring)" : "var(--oc-border)"}`,
                  color: s.attached ? "var(--oc-accent)" : "var(--oc-text-muted)",
                }}
              >
                {s.attached ? "attached" : "available"}
              </span>
              {!s.catalog && (
                <span
                  className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--oc-border)",
                    color: "var(--oc-text-muted)",
                  }}
                >
                  local only
                </span>
              )}
              {(s.platforms ?? []).map((p) => (
                <span
                  key={p}
                  className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
                  style={{
                    background:
                      p === "all"
                        ? "var(--oc-accent-soft)"
                        : "rgba(255,255,255,0.04)",
                    border: `1px solid ${p === "all" ? "var(--oc-accent-ring)" : "var(--oc-border)"}`,
                    color:
                      p === "all" ? "var(--oc-accent)" : "var(--oc-text-dim)",
                  }}
                >
                  {p}
                </span>
              ))}
              {(s.tags ?? []).map((t) => (
                <span
                  key={t}
                  className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--oc-border)",
                    color: "var(--oc-text-muted)",
                  }}
                >
                  #{t}
                </span>
              ))}
            </div>
            <div
              className="mt-0.5 flex gap-1.5 border-t pt-2"
              style={{ borderColor: "var(--oc-border)" }}
            >
              <Button variant="ghost" size="sm" onClick={() => setViewing(s)}>
                View
              </Button>
              <Button
                variant={s.attached ? "ghost" : "outline"}
                size="sm"
                className="ml-auto"
                disabled={!s.catalog && !s.attached}
                onClick={() => handleSkillAttachment(s.name, Boolean(s.attached))}
              >
                {s.attached ? (
                  <>
                    <Trash2 className="h-3 w-3" />
                    Detach
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3" />
                    Attach
                  </>
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {skills.length === 0 && (
        <div className="p-10 text-center text-xs" style={{ color: "var(--oc-text-muted)" }}>
          No skills installed.
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent
          className="sm:max-w-[480px]"
          style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border-mid)" }}
        >
          <DialogHeader>
            <DialogTitle>Upload skill</DialogTitle>
            <DialogDescription>
              Drop a .zip, .tar.gz, or .skill archive. Must contain SKILL.md.
            </DialogDescription>
          </DialogHeader>
          <label
            className="flex cursor-pointer flex-col items-center gap-2.5 rounded-md border-2 border-dashed p-8"
            style={{
              borderColor: "var(--oc-border-mid)",
              background: "var(--oc-bg2)",
            }}
          >
            <Upload className="h-6 w-6" style={{ color: "var(--oc-accent)" }} />
            <span className="text-[13px]" style={{ color: "var(--color-foreground)" }}>
              Drop a skill archive here, or{" "}
              <span style={{ color: "var(--oc-accent)" }}>browse</span>
            </span>
            <span className="text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
              .zip &middot; .tar.gz &middot; .tgz &middot; .skill &middot; max 10 MB
            </span>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".zip,.tar.gz,.tgz,.skill"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
          </label>
        </DialogContent>
      </Dialog>

      {/* Git clone dialog */}
      <Dialog open={gitOpen} onOpenChange={setGitOpen}>
        <DialogContent
          className="sm:max-w-[480px]"
          style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border-mid)" }}
        >
          <DialogHeader>
            <DialogTitle>Clone skill from git</DialogTitle>
            <DialogDescription>
              Repo must contain a SKILL.md at root or one level deep.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field label="Git URL">
              <input
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/example/skill-incident-report.git"
                className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                style={{
                  background: "var(--oc-bg3)",
                  borderColor: "var(--oc-border)",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--oc-mono)",
                }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ref (branch / tag)">
                <input
                  value={gitBranch}
                  onChange={(e) => setGitBranch(e.target.value)}
                  className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                  }}
                />
              </Field>
              <Field label="Name override">
                <input
                  value={gitName}
                  onChange={(e) => setGitName(e.target.value)}
                  placeholder="(from repo name)"
                  className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                  }}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGitOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!gitUrl} onClick={handleGitClone}>
              <GitBranch className="h-3 w-3" />
              Clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Skill viewer dialog */}
      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent
          className="sm:max-w-[640px]"
          style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border-mid)" }}
        >
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
            <DialogDescription>{viewing?.description}</DialogDescription>
          </DialogHeader>
          <div
            className="max-h-[480px] overflow-auto whitespace-pre-wrap p-4 text-[12.5px] leading-relaxed"
            style={{
              fontFamily: "var(--oc-mono)",
              color: "var(--color-foreground)",
            }}
          >
            {viewing && (
              <>
                <div style={{ color: "var(--oc-text-muted)" }}>
                  ---{"\n"}
                  name: {viewing.name}
                  {"\n"}
                  description: {viewing.description}
                  {"\n"}
                  platforms: [{viewing.platforms.join(", ")}]
                  {"\n"}
                  tags: [{viewing.tags.join(", ")}]
                  {"\n"}
                  ---
                </div>
                {"\n\n"}# {viewing.name}
                {"\n\n"}
                {viewing.description}
                {"\n\n"}## Triggers{"\n\n"}
                Invoked automatically when the user mentions keywords from tags,
                or explicitly via &quot;use skill {viewing.name}&quot;.{"\n\n"}
                ## Behavior{"\n\n"}
                1. Collect context from the last N messages.{"\n"}
                2. Apply the skill-specific transform.{"\n"}
                3. Return a structured response.
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
