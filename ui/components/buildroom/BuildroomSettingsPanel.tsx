"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, Save, SlidersHorizontal } from "lucide-react";

interface BuildroomConfigPayload {
  watch: {
    repo: { enabled: boolean };
    docs: { enabled: boolean };
    tests: { enabled: boolean };
    sessions: { enabled: boolean };
    rawTranscripts: { enabled: boolean };
    external: { enabled: boolean };
  };
  paths: {
    allowed: string[];
    blocked: string[];
  };
  notifications: {
    routes: string[];
  };
  budgets: {
    maxIdeasPerDay: number;
    maxBuildsPerDay: number;
    maxActiveBuilds: number;
    maxRuntimeMinutesPerStage: number;
  };
}

interface BuildroomConfigResponse {
  ok: true;
  initialized: boolean;
  config: BuildroomConfigPayload | null;
}

interface SettingsForm {
  watch: {
    repo: boolean;
    docs: boolean;
    tests: boolean;
    sessions: boolean;
    external: boolean;
  };
  allowedPaths: string;
  blockedPaths: string;
  notificationRoutes: string;
  budgets: {
    maxIdeasPerDay: string;
    maxBuildsPerDay: string;
    maxActiveBuilds: string;
    maxRuntimeMinutesPerStage: string;
  };
}

export function BuildroomSettingsPanel({ initialized }: { initialized: boolean }) {
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    if (!initialized) return;
    setLoading(true);
    setError(null);
    try {
      const body = await requestConfig("/api/buildroom/config");
      setForm(body.config ? formFromConfig(body.config) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Buildroom settings");
    } finally {
      setLoading(false);
    }
  }, [initialized]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  if (!initialized) {
    return (
      <InlineMessage
        tone="yellow"
        title="Buildroom is not initialized"
        text="Initialize the room before editing Buildroom settings."
      />
    );
  }

  async function saveSettings() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body = await requestConfig("/api/buildroom/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchFromForm(form)),
      });
      setForm(body.config ? formFromConfig(body.config) : form);
      setMessage("Settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save Buildroom settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="min-w-0 rounded-md border"
      style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}
    >
      <div className="border-b px-3 py-2.5" style={{ borderColor: "var(--oc-border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5" style={{ color: "var(--oc-text-muted)" }} />
            <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--color-foreground)" }}>
              Settings
              <HelpHint
                label="Settings"
                hint="These settings define what Buildroom may observe, where it may write, how much work it may schedule, and where operator notifications go."
              />
            </span>
          </div>
          <button
            type="button"
            onClick={saveSettings}
            disabled={!form || loading || saving}
            className="flex h-8 items-center gap-2 rounded-[5px] border px-2.5 text-xs transition-colors hover:bg-[var(--oc-bg2)] disabled:opacity-50"
            style={{ borderColor: "var(--oc-border)", color: "var(--color-foreground)", background: "var(--oc-bg0)" }}
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save settings
          </button>
        </div>
      </div>

      <div className="p-3">
        <div className="mb-3 rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}>
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--color-foreground)" }}>
            What do these settings control?
            <HelpHint
              label="Buildroom settings"
              hint="Buildroom config is project-local. The UI edits only safe v0.1 fields and still validates the resulting config before saving."
            />
          </div>
          <p className="mt-1.5 text-xs leading-5" style={{ color: "var(--oc-text-dim)" }}>
            These settings define what Buildroom may observe, what repository paths are inside the
            build box, what must stay blocked, how much work can happen per day, and where automatic
            notifications are sent. They do not approve work and they do not bypass policy checks.
          </p>
        </div>

        {error ? <InlineMessage tone="red" title="Settings failed" text={error} /> : null}
        {message ? (
          <div className="mb-3 rounded-[5px] border px-3 py-2 text-xs" style={{ borderColor: "var(--oc-border)", color: "var(--oc-green)", background: "var(--oc-bg0)" }}>
            {message}
          </div>
        ) : null}

        {loading || !form ? (
          <div className="h-[260px] rounded-md border" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }} />
        ) : (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)]">
            <div className="grid gap-3">
              <SettingsBlock
                title="Watch sources"
                hint="Watch sources decide what can become evidence or proposal input. Watching something does not approve work."
                description="Watch sources decide what can become evidence. They do not create authority, approvals, or builds."
              >
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <CheckboxField label="Repository" hint="Allow Buildroom Research to inspect approved local repository files as evidence." checked={form.watch.repo} onChange={(repo) => setForm({ ...form, watch: { ...form.watch, repo } })} />
                  <CheckboxField label="Docs" hint="Allow documentation files to become evidence for proposals and QA checks." checked={form.watch.docs} onChange={(docs) => setForm({ ...form, watch: { ...form.watch, docs } })} />
                  <CheckboxField label="Tests" hint="Allow tests and test fixtures to become evidence. This does not run tests by itself." checked={form.watch.tests} onChange={(tests) => setForm({ ...form, watch: { ...form.watch, tests } })} />
                  <CheckboxField label="Session summaries" hint="Allow sanitized ordinary-agent session summaries. Raw private transcripts remain disabled." checked={form.watch.sessions} onChange={(sessions) => setForm({ ...form, watch: { ...form.watch, sessions } })} />
                  <CheckboxField label="External signals" hint="Allow configured external read-only signals later. v0.1 still blocks external mutating side effects by default." checked={form.watch.external} onChange={(external) => setForm({ ...form, watch: { ...form.watch, external } })} />
                  <CheckboxField label="Raw transcripts" hint="Raw transcripts are disabled in v0.1 because Buildroom should watch sanitized summaries, not private chat history." checked={false} disabled onChange={() => undefined} />
                </div>
              </SettingsBlock>

              <SettingsBlock
                title="Path policy"
                hint="Path policy defines the build box. Builder may only write approved paths and must never write blocked paths."
                description="Allowed paths are the only places Builder may write. Blocked paths always win and protect secrets, agent config, runtime data, and Buildroom config."
              >
                <div className="grid gap-3 lg:grid-cols-2">
                  <TextareaField
                    label="Allowed paths"
                    hint="Repository path patterns Builder may write after approval. Keep this narrow: docs/examples/tests are safer than broad source or config paths."
                    value={form.allowedPaths}
                    onChange={(allowedPaths) => setForm({ ...form, allowedPaths })}
                  />
                  <TextareaField
                    label="Blocked paths"
                    hint="Repository path patterns Builder must not write even if they also match allowed paths. Use this for secrets, config, agents, data, and audit state."
                    value={form.blockedPaths}
                    onChange={(blockedPaths) => setForm({ ...form, blockedPaths })}
                  />
                </div>
              </SettingsBlock>

              <SettingsBlock
                title="Notifications"
                hint="Notification routes receive automatic Buildroom reports. They do not grant approval authority by themselves."
                description="Notification routes are for automatic reports like blocked state, QA completed, or trust report generated. Approval still requires explicit operator commands."
              >
                <TextareaField
                  label="Notification routes"
                  hint="Routes such as telegram_thread:-1003931616911:2. Notification route is route evidence, not operator identity."
                  value={form.notificationRoutes}
                  onChange={(notificationRoutes) => setForm({ ...form, notificationRoutes })}
                />
              </SettingsBlock>
            </div>

            <SettingsBlock
              title="Budgets"
              hint="Budgets limit how much autonomous Buildroom work can happen before an operator reviews the situation."
              description="Budgets are safety rails. Lower values reduce accidental loops while the v0.1 workflow is still being proven."
            >
              <div className="grid gap-2">
                <NumberField
                  label="Max ideas per day"
                  hint="Maximum idea/proposal candidates Buildroom may create per day. It limits suggestion volume, not approval."
                  value={form.budgets.maxIdeasPerDay}
                  onChange={(maxIdeasPerDay) => setForm({ ...form, budgets: { ...form.budgets, maxIdeasPerDay } })}
                />
                <NumberField
                  label="Max builds per day"
                  hint="Daily safety budget for Builder attempts. A build still requires explicit approval and valid scope."
                  value={form.budgets.maxBuildsPerDay}
                  onChange={(maxBuildsPerDay) => setForm({ ...form, budgets: { ...form.budgets, maxBuildsPerDay } })}
                />
                <NumberField
                  label="Max active builds"
                  hint="Maximum concurrent Builder runs. v0.1 should normally stay at 1 to prevent duplicate or competing mutations."
                  value={form.budgets.maxActiveBuilds}
                  onChange={(maxActiveBuilds) => setForm({ ...form, budgets: { ...form.budgets, maxActiveBuilds } })}
                />
                <NumberField
                  label="Max runtime minutes per stage"
                  hint="Maximum runtime duration for a single Buildroom stage before it should fail closed with a durable error receipt."
                  value={form.budgets.maxRuntimeMinutesPerStage}
                  onChange={(maxRuntimeMinutesPerStage) => setForm({ ...form, budgets: { ...form.budgets, maxRuntimeMinutesPerStage } })}
                />
              </div>
            </SettingsBlock>
          </div>
        )}
      </div>
    </section>
  );
}

async function requestConfig(url: string, init?: RequestInit): Promise<BuildroomConfigResponse> {
  const res = await fetch(url, init);
  const body = await res.json() as unknown;
  if (!res.ok) {
    throw new Error(readErrorMessage(body));
  }
  return body as BuildroomConfigResponse;
}

function formFromConfig(config: BuildroomConfigPayload): SettingsForm {
  return {
    watch: {
      repo: config.watch.repo.enabled,
      docs: config.watch.docs.enabled,
      tests: config.watch.tests.enabled,
      sessions: config.watch.sessions.enabled,
      external: config.watch.external.enabled,
    },
    allowedPaths: config.paths.allowed.join("\n"),
    blockedPaths: config.paths.blocked.join("\n"),
    notificationRoutes: config.notifications.routes.join("\n"),
    budgets: {
      maxIdeasPerDay: String(config.budgets.maxIdeasPerDay),
      maxBuildsPerDay: String(config.budgets.maxBuildsPerDay),
      maxActiveBuilds: String(config.budgets.maxActiveBuilds),
      maxRuntimeMinutesPerStage: String(config.budgets.maxRuntimeMinutesPerStage),
    },
  };
}

function patchFromForm(form: SettingsForm) {
  return {
    watch: form.watch,
    paths: {
      allowed: lines(form.allowedPaths),
      blocked: lines(form.blockedPaths),
    },
    budgets: {
      maxIdeasPerDay: positiveInteger(form.budgets.maxIdeasPerDay),
      maxBuildsPerDay: positiveInteger(form.budgets.maxBuildsPerDay),
      maxActiveBuilds: positiveInteger(form.budgets.maxActiveBuilds),
      maxRuntimeMinutesPerStage: positiveInteger(form.budgets.maxRuntimeMinutesPerStage),
    },
    notifications: {
      routes: lines(form.notificationRoutes),
    },
  };
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function readErrorMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Buildroom request failed";
}

function SettingsBlock({
  title,
  hint,
  description,
  children,
}: {
  title: string;
  hint: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
        {title}
        <HelpHint label={title} hint={hint} />
      </div>
      <div className="mb-3 mt-1 text-xs leading-5" style={{ color: "var(--oc-text-dim)" }}>
        {description}
      </div>
      {children}
    </div>
  );
}

function CheckboxField({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-8 items-center gap-2 rounded-[5px] border px-2.5 text-xs" style={{ borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5"
      />
      <span>{label}</span>
      <HelpHint label={label} hint={hint} />
    </label>
  );
}

function TextareaField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
        {label}
        <HelpHint label={label} hint={hint} />
      </span>
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        className="min-h-[96px] resize-y rounded-[5px] border bg-transparent px-2 py-2 text-xs outline-none focus:border-[var(--oc-accent)]"
        style={{
          borderColor: "var(--oc-border)",
          color: "var(--color-foreground)",
          background: "var(--oc-bg1)",
          fontFamily: "var(--oc-mono)",
        }}
      />
    </label>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
        {label}
        <HelpHint label={label} hint={hint} />
      </span>
      <input
        aria-label={label}
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-[5px] border bg-transparent px-2 text-xs outline-none focus:border-[var(--oc-accent)]"
        style={{
          borderColor: "var(--oc-border)",
          color: "var(--color-foreground)",
          background: "var(--oc-bg1)",
          fontFamily: "var(--oc-mono)",
        }}
      />
    </label>
  );
}

function HelpHint({ label, hint }: { label: string; hint: string }) {
  return (
    <span
      aria-label={`What does ${label} mean?`}
      title={hint}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none"
      style={{ borderColor: "var(--oc-border)", color: "var(--oc-text-muted)", background: "var(--oc-bg1)" }}
    >
      ?
    </span>
  );
}

function InlineMessage({ tone, title, text }: { tone: "yellow" | "red"; title: string; text: string }) {
  const color = tone === "red" ? "var(--oc-red)" : "var(--oc-yellow)";
  return (
    <div className="rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}>
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color }}>
        <AlertTriangle className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--oc-text-dim)" }}>
        {text}
      </div>
    </div>
  );
}
