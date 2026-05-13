"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface ClaudeAuthCredentialFile {
  exists: boolean;
  updatedAt?: string | null;
  path?: string;
}

interface ClaudeAuthSessionPublic {
  sessionId: string;
  status: "starting" | "waiting_for_code" | "completing" | "failed";
  loginUrl: string | null;
  safeOutput?: string;
  error?: string | null;
}

interface ClaudeAuthStatus {
  connected?: boolean;
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string | null;
  email?: string | null;
  subscriptionType?: string | null;
  runtimeHome?: string;
  cliCommand?: string;
  credentialFile?: ClaudeAuthCredentialFile;
  error?: string | null;
  pendingSession?: ClaudeAuthSessionPublic | null;
}

interface CompleteResponse {
  ok: boolean;
  restarted?: boolean;
  restartError?: string | null;
  status?: ClaudeAuthStatus;
  error?: string | null;
}

interface VerifyResponse {
  ok: boolean;
  message: string;
  stdoutPreview?: string;
}

export function ClaudeAuthPanel({ serverId }: { serverId: string }) {
  const base = useMemo(() => `/api/fleet/${serverId}/claude-auth`, [serverId]);
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(null);
  const [session, setSession] = useState<ClaudeAuthSessionPublic | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadStatus = async () => {
    setError("");
    try {
      const res = await fetch(`${base}/status`);
      const data = await res.json() as ClaudeAuthStatus;
      if (!res.ok) throw new Error(data.error ?? "Claude auth status is unavailable.");
      setStatus(data);
      setSession(data.pendingSession ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claude auth status is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const startLogin = async () => {
    setAction("start");
    setMessage("");
    setError("");
    try {
      const res = await fetch(`${base}/start`, { method: "POST" });
      const data = await res.json() as ClaudeAuthSessionPublic & { message?: string };
      if (!res.ok) throw new Error(data.message ?? "Claude login could not start.");
      setSession(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claude login could not start.");
    } finally {
      setAction(null);
    }
  };

  const completeLogin = async () => {
    if (!session) return;
    setAction("complete");
    setMessage("");
    setError("");
    try {
      const res = await fetch(`${base}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId, code }),
      });
      const data = await res.json() as CompleteResponse;
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Claude login did not complete.");
      setStatus(data.status ?? status);
      setSession(null);
      setCode("");
      setMessage(data.restarted ? "Runtime restarted after Claude auth update." : "Claude auth updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claude login did not complete.");
    } finally {
      setAction(null);
    }
  };

  const cancelLogin = async () => {
    setAction("cancel");
    try {
      await fetch(`${base}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session?.sessionId }),
      });
      setSession(null);
      setCode("");
      setMessage("Pending Claude login cancelled.");
    } catch {
      setError("Pending Claude login could not be cancelled.");
    } finally {
      setAction(null);
    }
  };

  const verify = async () => {
    setAction("verify");
    setMessage("");
    setError("");
    try {
      const res = await fetch(`${base}/verify`, { method: "POST" });
      const data = await res.json() as VerifyResponse;
      if (!res.ok || !data.ok) throw new Error(data.message ?? "Claude verification failed.");
      setMessage(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Claude verification failed.");
    } finally {
      setAction(null);
    }
  };

  const restartRuntime = async () => {
    setAction("restart");
    setMessage("");
    setError("");
    try {
      const res = await fetch(`${base}/restart-runtime`, { method: "POST" });
      if (!res.ok) throw new Error("Runtime restart failed.");
      setMessage("Runtime restarted.");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Runtime restart failed.");
    } finally {
      setAction(null);
    }
  };

  const connected = status?.connected === true;
  const credentialsLabel = status?.credentialFile?.exists
    ? status.credentialFile.updatedAt
      ? `updated ${new Date(status.credentialFile.updatedAt).toLocaleString("en-US")}`
      : "present"
    : "missing";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <SectionTitle>Claude subscription auth</SectionTitle>
            <StatusBadge connected={connected} loading={loading} />
          </div>
          <div className="mt-1 max-w-[620px] text-[11.5px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
            Connects the Claude Code runtime used by agent turns. Auth is stored in the service runtime home, not in root shell history or repository files.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadStatus()} disabled={loading || action !== null}>
          <RefreshCcw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <InfoCell label="Account" value={status?.email ?? (connected ? "connected" : "not connected")} />
        <InfoCell label="Subscription" value={status?.subscriptionType ?? "---"} />
        <InfoCell label="Auth method" value={status?.authMethod ?? "---"} />
        <InfoCell label="Credentials" value={credentialsLabel} warn={!status?.credentialFile?.exists} />
        <InfoCell label="Runtime home" value={status?.runtimeHome ?? "---"} wide />
        <InfoCell label="CLI command" value={status?.cliCommand ?? "claude"} />
      </div>

      {status?.error && <Notice tone="error" text={status.error} />}
      {error && <Notice tone="error" text={error} />}
      {message && <Notice tone="success" text={message} />}

      {session && (
        <div className="rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold" style={{ color: "var(--color-foreground)" }}>
              Authorization session
            </div>
            <Button variant="ghost" size="sm" onClick={() => void cancelLogin()} disabled={action !== null} className="h-7 px-2">
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {session.loginUrl && (
              <a href={session.loginUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" type="button">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open authorization page
                </Button>
              </a>
            )}
          </div>
          <label className="mt-3 block text-[10.5px] uppercase tracking-[0.45px]" style={{ color: "var(--oc-text-muted)" }}>
            Authorization code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="mt-1 h-8 w-full rounded-md border px-2 text-xs outline-none"
              style={{
                background: "var(--oc-bg3)",
                borderColor: "var(--oc-border)",
                color: "var(--color-foreground)",
                fontFamily: "var(--oc-mono)",
              }}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void completeLogin()} disabled={!code.trim() || action !== null}>
              {action === "complete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Complete connection
            </Button>
          </div>
          {session.safeOutput && (
            <pre
              className="mt-3 max-h-[120px] overflow-auto rounded border p-2 text-[10.5px] leading-relaxed"
              style={{
                background: "var(--oc-bg2)",
                borderColor: "var(--oc-border)",
                color: "var(--oc-text-dim)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              {session.safeOutput}
            </pre>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void startLogin()} disabled={action !== null || Boolean(session)}>
          {action === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          Connect Claude subscription
        </Button>
        <Button variant="outline" size="sm" onClick={() => void verify()} disabled={action !== null || !connected}>
          {action === "verify" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Verify
        </Button>
        <Button variant="outline" size="sm" onClick={() => void restartRuntime()} disabled={action !== null}>
          {action === "restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Restart runtime
        </Button>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13.5px] font-semibold" style={{ color: "var(--color-foreground)" }}>
      {children}
    </div>
  );
}

function StatusBadge({ connected, loading }: { connected: boolean; loading: boolean }) {
  const color = loading ? "var(--oc-text-muted)" : connected ? "var(--oc-green)" : "var(--oc-yellow)";
  const Icon = loading ? Loader2 : connected ? CheckCircle2 : AlertTriangle;
  return (
    <span className="inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.4px]" style={{ borderColor: "var(--oc-border-mid)", color, background: "var(--oc-bg2)" }}>
      <Icon className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Checking" : connected ? "Connected" : "Needs auth"}
    </span>
  );
}

function InfoCell({ label, value, warn = false, wide = false }: { label: string; value: string; warn?: boolean; wide?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${wide ? "sm:col-span-2" : ""}`} style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}>
      <div className="text-[10.5px] uppercase tracking-[0.5px]" style={{ color: "var(--oc-text-muted)" }}>{label}</div>
      <div className="mt-1 break-all text-xs" style={{ color: warn ? "var(--oc-yellow)" : "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
        {value}
      </div>
    </div>
  );
}

function Notice({ tone, text }: { tone: "success" | "error"; text: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
      style={{
        borderColor: tone === "success" ? "rgba(74,222,128,0.35)" : "rgba(248,113,113,0.35)",
        background: tone === "success" ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
        color: tone === "success" ? "var(--oc-green)" : "var(--oc-red)",
      }}
    >
      {tone === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      {text}
    </div>
  );
}
