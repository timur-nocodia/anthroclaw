"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  User,
  Key,
  Activity,
  Tag,
  Shield,
  BookOpen,
  Copy,
  RefreshCw,
  Plus,
  Monitor,
  Smartphone,
  X,
  LogOut,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TabId = "profile" | "tokens" | "sessions" | "usage";

interface ApiKeyInfo {
  key: string | null;
  createdAt?: string;
}

interface MetricsData {
  inputTokens?: number;
  outputTokens?: number;
  totalRequests?: number;
  [k: string]: unknown;
}

interface SessionRecord {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string;
  ip: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "tokens", label: "API tokens", icon: Key },
  { id: "sessions", label: "Active sessions", icon: Activity },
  { id: "usage", label: "Usage stats", icon: Tag },
];

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function AccountPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as TabId | null;
  const [tab, setTab] = useState<TabId>(
    tabParam && TABS.some((t) => t.id === tabParam) ? tabParam : "profile",
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <div>
          <div className="flex items-center gap-2.5">
            <h1
              className="text-[15px] font-semibold"
              style={{ color: "var(--color-foreground)" }}
            >
              Account
            </h1>
            <span
              className="inline-flex items-center rounded-[4px] px-1.5 py-px text-[10px] font-medium"
              style={{
                background: "var(--oc-accent-soft)",
                color: "var(--oc-accent)",
                border: "1px solid var(--oc-accent-ring)",
              }}
            >
              you
            </span>
          </div>
          <p
            className="mt-0.5 text-[11.5px]"
            style={{ color: "var(--oc-text-muted)" }}
          >
            Your profile, tokens, and sessions.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm">
            <BookOpen className="h-3.5 w-3.5" />
            Docs
          </Button>
          <Button variant="outline" size="sm">
            <Shield className="h-3.5 w-3.5" />
            Security log
          </Button>
        </div>
      </div>

      {/* Body: sidebar tabs + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tab sidebar */}
        <div
          className="flex min-h-0 w-[220px] flex-col p-2.5"
          style={{
            borderRight: "1px solid var(--oc-border)",
            background: "var(--oc-bg0)",
          }}
        >
          <div className="flex flex-col gap-0.5">
            {TABS.map((t) => {
              const active = tab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="flex items-center gap-2 rounded-[5px] px-2.5 py-[7px] text-left text-[12.5px]"
                  style={{
                    background: active ? "var(--oc-bg2)" : "transparent",
                    border: "none",
                    color: active
                      ? "var(--color-foreground)"
                      : "var(--oc-text-dim)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    className="flex h-[13px] w-[13px] items-center justify-center"
                    style={{
                      color: active
                        ? "var(--color-foreground)"
                        : "var(--oc-text-muted)",
                    }}
                  >
                    <Icon className="h-[13px] w-[13px]" />
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Sign out — pinned to bottom */}
          <div
            className="mt-auto border-t pt-2.5"
            style={{ borderColor: "var(--oc-border)" }}
          >
            <button
              onClick={() => {
                fetch("/api/auth/logout", { method: "POST" }).then(() => {
                  router.push("/login");
                });
              }}
              className="flex w-full items-center gap-2 rounded-[5px] px-2.5 py-[7px] text-left text-[12.5px]"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--oc-red, #f87171)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <LogOut className="h-[13px] w-[13px]" />
              Sign out
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {tab === "profile" && <ProfileTab />}
          {tab === "tokens" && <TokensTab />}
          {tab === "sessions" && <SessionsTab />}
          {tab === "usage" && <UsageTab />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

function AcctSection({
  title,
  desc,
  actions,
  children,
}: {
  title: string;
  desc?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mb-3.5 rounded-md"
      style={{
        background: "var(--oc-bg1)",
        border: "1px solid var(--oc-border)",
      }}
    >
      <div
        className="flex items-center justify-between gap-2.5 px-3.5 py-[11px]"
        style={{ borderBottom: "1px solid var(--oc-border)" }}
      >
        <div>
          <div
            className="text-[12.5px] font-semibold"
            style={{ color: "var(--color-foreground)" }}
          >
            {title}
          </div>
          {desc && (
            <div
              className="mt-0.5 text-[11px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              {desc}
            </div>
          )}
        </div>
        {actions && <div className="flex gap-1.5">{actions}</div>}
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="grid items-center gap-3.5 py-[9px]"
      style={{
        gridTemplateColumns: "160px 1fr auto",
        borderBottom: "1px dashed var(--oc-border)",
      }}
    >
      <span
        className="text-[11.5px] uppercase tracking-[0.4px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {label}
      </span>
      <div className="min-w-0">
        <div
          className="overflow-hidden text-ellipsis text-[12.5px]"
          style={{
            color: "var(--color-foreground)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          {value}
        </div>
        {hint && (
          <div
            className="mt-0.5 text-[11px]"
            style={{ color: "var(--oc-text-muted)" }}
          >
            {hint}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

function SmallBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "green" | "yellow" | "red" | "mono";
}) {
  const tones: Record<string, { bg: string; fg: string; border: string }> = {
    neutral: {
      bg: "rgba(255,255,255,0.04)",
      fg: "var(--oc-text-dim)",
      border: "var(--oc-border)",
    },
    accent: {
      bg: "var(--oc-accent-soft)",
      fg: "var(--oc-accent)",
      border: "var(--oc-accent-ring)",
    },
    green: {
      bg: "rgba(74,222,128,0.15)",
      fg: "var(--oc-green, #4ade80)",
      border: "rgba(74,222,128,0.35)",
    },
    yellow: {
      bg: "rgba(251,191,36,0.15)",
      fg: "var(--oc-yellow, #fbbf24)",
      border: "rgba(251,191,36,0.35)",
    },
    red: {
      bg: "rgba(248,113,113,0.15)",
      fg: "var(--oc-red, #f87171)",
      border: "rgba(248,113,113,0.35)",
    },
    mono: {
      bg: "rgba(255,255,255,0.03)",
      fg: "var(--oc-text-muted)",
      border: "var(--oc-border)",
    },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[4px] px-[5px] py-px text-[10px] font-medium"
      style={{
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        letterSpacing: "0.1px",
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile Tab                                                        */
/* ------------------------------------------------------------------ */

function ProfileTab() {
  const [email, setEmail] = useState("...");
  const [locale, setLocale] = useState("...");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    setLocale(navigator.language);
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (d.email) setEmail(d.email); })
      .catch(() => {});
  }, []);

  const handleChangePassword = async () => {
    setPwError("");
    setPwSuccess(false);
    if (newPw !== confirmPw) {
      setPwError("Passwords do not match.");
      return;
    }
    if (newPw.length < 8) {
      setPwError("Password must be at least 8 characters.");
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      if (res.ok) {
        setPwSuccess(true);
        setCurrentPw("");
        setNewPw("");
        setConfirmPw("");
        toast.success("Password changed successfully.");
      } else {
        const d = await res.json().catch(() => ({}));
        setPwError(
          d.error === "wrong_password"
            ? "Current password is incorrect."
            : d.error === "password_too_short"
              ? "Password must be at least 8 characters."
              : "Failed to change password.",
        );
      }
    } catch {
      setPwError("Network error.");
    } finally {
      setPwSaving(false);
    }
  };

  const initial = email !== "..." ? email.charAt(0).toUpperCase() : "A";

  return (
    <>
      <AcctSection title="You" desc={`Signed in as ${email}.`}>
        <div className="mb-4 flex items-center gap-4">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-[26px] font-bold"
            style={{
              background: "linear-gradient(135deg, #7c9cff, #c084fc)",
              color: "#0b0d12",
            }}
          >
            {initial}
          </div>
          <div>
            <div
              className="text-[16px] font-semibold"
              style={{ color: "var(--color-foreground)" }}
            >
              Admin
            </div>
            <div
              className="text-[12px]"
              style={{
                color: "var(--oc-text-muted)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              {email}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <SmallBadge tone="accent">Owner</SmallBadge>
              <SmallBadge tone="green">Single-user</SmallBadge>
            </div>
          </div>
        </div>

        <Row label="Email" value={email} hint="Configured via ADMIN_EMAIL env var" />
        <Row
          label="Timezone"
          value={Intl.DateTimeFormat().resolvedOptions().timeZone}
        />
        <Row label="Locale" value={locale} />
      </AcctSection>

      <AcctSection title="Change password">
        <div className="flex max-w-[380px] flex-col gap-2.5">
          <PwField label="Current password" value={currentPw} onChange={setCurrentPw} />
          <PwField label="New password" value={newPw} onChange={setNewPw} />
          <PwField label="Confirm password" value={confirmPw} onChange={setConfirmPw} />
          {pwError && (
            <p className="text-[11px]" style={{ color: "var(--oc-red)", fontFamily: "var(--oc-mono)" }}>
              {pwError}
            </p>
          )}
          {pwSuccess && (
            <p className="text-[11px]" style={{ color: "var(--oc-green)", fontFamily: "var(--oc-mono)" }}>
              Password changed successfully.
            </p>
          )}
          <div>
            <Button
              size="sm"
              disabled={!currentPw || !newPw || !confirmPw || pwSaving}
              onClick={handleChangePassword}
            >
              <Key className="h-3 w-3" />
              {pwSaving ? "Saving..." : "Change password"}
            </Button>
          </div>
        </div>
      </AcctSection>
    </>
  );
}

function PwField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid items-center gap-3" style={{ gridTemplateColumns: "140px 1fr" }}>
      <span className="text-[11.5px]" style={{ color: "var(--oc-text-dim)" }}>
        {label}
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-[5px] border px-2 text-xs outline-none"
        style={{
          background: "var(--oc-bg3)",
          borderColor: "var(--oc-border)",
          color: "var(--color-foreground)",
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tokens Tab                                                         */
/* ------------------------------------------------------------------ */

function TokensTab() {
  const [apiKey, setApiKey] = useState<ApiKeyInfo | null>(null);
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchKey = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/api-key");
      if (res.ok) {
        const data = await res.json();
        setApiKey(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKey();
  }, [fetchKey]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/auth/api-key", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setFullKey(data.key);
        toast.success("API key generated. Copy it now — it won't be shown again.");
        fetchKey();
      }
    } catch {
      toast.error("Failed to generate API key.");
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async () => {
    try {
      const res = await fetch("/api/auth/api-key", { method: "DELETE" });
      if (res.ok) {
        setApiKey({ key: null });
        setFullKey(null);
        toast.success("API key revoked.");
      }
    } catch {
      toast.error("Failed to revoke API key.");
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard.");
  };

  return (
    <AcctSection
      title="Personal API tokens"
      desc="Tokens authenticate as you across the Control API. Rotate or revoke anytime."
      actions={
        <Button size="sm" disabled={generating} onClick={handleGenerate}>
          <Plus className="h-3 w-3" />
          {generating ? "Generating..." : "New token"}
        </Button>
      }
    >
      {loading ? (
        <div
          className="py-8 text-center text-[12px]"
          style={{ color: "var(--oc-text-muted)" }}
        >
          Loading...
        </div>
      ) : (
        <div className="flex flex-col">
          {fullKey && (
            <div
              className="mb-4 rounded-md p-3.5"
              style={{
                background: "rgba(74,222,128,0.08)",
                border: "1px solid rgba(74,222,128,0.3)",
              }}
            >
              <div
                className="mb-2 text-[12px] font-medium"
                style={{ color: "var(--oc-green, #4ade80)" }}
              >
                New API key generated — copy it now, it will not be shown again.
              </div>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 overflow-hidden text-ellipsis text-[11.5px]"
                  style={{
                    color: "var(--color-foreground)",
                    fontFamily: "var(--oc-mono)",
                    background: "var(--oc-bg2)",
                    padding: "6px 10px",
                    borderRadius: 4,
                    border: "1px solid var(--oc-border)",
                  }}
                >
                  {fullKey}
                </code>
                <Button variant="outline" size="sm" onClick={() => handleCopy(fullKey)}>
                  <Copy className="h-3 w-3" />
                  Copy
                </Button>
              </div>
            </div>
          )}

          {apiKey?.key ? (
            <div
              className="flex items-center gap-3.5 px-1 py-3"
              style={{ borderBottom: "1px solid var(--oc-border)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="text-[12.5px] font-medium"
                    style={{ color: "var(--color-foreground)" }}
                  >
                    Admin API key
                  </span>
                  <SmallBadge tone="green">active</SmallBadge>
                </div>
                <div
                  className="text-[11.5px]"
                  style={{
                    color: "var(--oc-text-muted)",
                    fontFamily: "var(--oc-mono)",
                  }}
                >
                  {apiKey.key}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleGenerate}>
                <RefreshCw className="h-3 w-3" />
                Rotate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevoke}
                className="text-red-400 hover:text-red-300"
              >
                Revoke
              </Button>
            </div>
          ) : (
            !fullKey && (
              <div
                className="py-8 text-center text-[12px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                No API key generated yet. Click &ldquo;New token&rdquo; to create one.
              </div>
            )
          )}
        </div>
      )}
    </AcctSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Sessions Tab                                                       */
/* ------------------------------------------------------------------ */

function SessionsTab() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/sessions");
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevoke = async (id: string) => {
    try {
      const res = await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
        toast.success("Session revoked.");
      }
    } catch {
      toast.error("Failed to revoke session.");
    }
  };

  const handleRevokeAll = async () => {
    try {
      const res = await fetch("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "all" }),
      });
      if (res.ok) {
        setSessions([]);
        toast.success("All sessions revoked.");
      }
    } catch {
      toast.error("Failed to revoke sessions.");
    }
  };

  const getBrowserName = (ua: string): string => {
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Chrome") && !ua.includes("Edg")) return "Chrome";
    if (ua.includes("Edg")) return "Edge";
    if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari";
    return "Unknown";
  };

  const getOSName = (ua: string): string => {
    if (ua.includes("Mac OS")) return "macOS";
    if (ua.includes("Windows")) return "Windows";
    if (ua.includes("Linux")) return "Linux";
    if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
    if (ua.includes("Android")) return "Android";
    return "Unknown";
  };

  const isMobile = (ua: string): boolean =>
    /iPhone|iPad|Android|Mobile/i.test(ua);

  const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <AcctSection
      title={`Active sessions (${sessions.length})`}
      desc="Browser sessions signed in to this control panel."
      actions={
        sessions.length > 1 ? (
          <Button variant="outline" size="sm" onClick={handleRevokeAll}>
            <Trash2 className="h-3 w-3" />
            Revoke all
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <div
          className="py-8 text-center text-[12px]"
          style={{ color: "var(--oc-text-muted)" }}
        >
          Loading...
        </div>
      ) : sessions.length === 0 ? (
        <div
          className="py-8 text-center text-[12px]"
          style={{ color: "var(--oc-text-muted)" }}
        >
          No active sessions.
        </div>
      ) : (
        <div className="flex flex-col">
          {sessions.map((session, i) => {
            const os = getOSName(session.userAgent);
            const browser = getBrowserName(session.userAgent);
            const mobile = isMobile(session.userAgent);
            const DeviceIcon = mobile ? Smartphone : Monitor;

            return (
              <div
                key={session.id}
                className="flex items-center gap-3.5 px-1 py-3"
                style={{
                  borderBottom:
                    i < sessions.length - 1
                      ? "1px solid var(--oc-border)"
                      : "none",
                }}
              >
                <DeviceIcon
                  className="h-4 w-4 shrink-0"
                  style={{ color: "var(--oc-accent)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[12.5px] font-medium"
                      style={{ color: "var(--color-foreground)" }}
                    >
                      {os} — {browser}
                    </span>
                    {i === sessions.length - 1 && (
                      <SmallBadge tone="accent">latest</SmallBadge>
                    )}
                  </div>
                  <div
                    className="mt-0.5 text-[11px]"
                    style={{
                      color: "var(--oc-text-muted)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    {session.ip} · created {timeAgo(session.createdAt)} · last seen {timeAgo(session.lastSeenAt)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRevoke(session.id)}
                >
                  <X className="h-3 w-3" />
                  Revoke
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </AcctSection>
  );
}

/* ------------------------------------------------------------------ */
/*  Usage Stats Tab (formerly Billing)                                 */
/* ------------------------------------------------------------------ */

function UsageTab() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);

  useEffect(() => {
    fetch("/api/metrics")
      .then((r) => r.json())
      .then(setMetrics)
      .catch(() => {});
  }, []);

  const inputTokens = metrics?.inputTokens ?? 0;
  const outputTokens = metrics?.outputTokens ?? 0;
  const totalRequests = metrics?.totalRequests ?? 0;

  const inputCost = (inputTokens / 1_000_000) * 3;
  const outputCost = (outputTokens / 1_000_000) * 15;
  const totalCost = inputCost + outputCost;

  const fmtNum = (n: number) => n.toLocaleString();
  const fmtCost = (n: number) => `$${n.toFixed(2)}`;

  return (
    <>
      <AcctSection title="Overview">
        <div className="grid grid-cols-3 gap-3.5">
          <div
            className="relative rounded-md p-3.5"
            style={{
              background: "var(--oc-bg0)",
              border: "1px solid var(--oc-accent-ring)",
            }}
          >
            <SmallBadge tone="accent">current</SmallBadge>
            <div
              className="mt-2 text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Self-hosted
            </div>
            <div
              className="my-1.5 text-[22px] font-semibold"
              style={{
                color: "var(--color-foreground)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              Free
            </div>
            <div
              className="text-[11.5px] leading-relaxed"
              style={{ color: "var(--oc-text-dim)" }}
            >
              Single gateway — unlimited agents — BYOK
            </div>
          </div>
          <div
            className="rounded-md p-3.5"
            style={{
              background: "var(--oc-bg0)",
              border: "1px solid var(--oc-border)",
            }}
          >
            <div
              className="text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Token usage
            </div>
            <div
              className="my-1.5 text-[22px] font-semibold"
              style={{
                color: "var(--color-foreground)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              {fmtNum(inputTokens + outputTokens)}
            </div>
            <div
              className="text-[11.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              {fmtNum(inputTokens)} input + {fmtNum(outputTokens)} output
            </div>
          </div>
          <div
            className="rounded-md p-3.5"
            style={{
              background: "var(--oc-bg0)",
              border: "1px solid var(--oc-border)",
            }}
          >
            <div
              className="text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Est. API cost
            </div>
            <div
              className="my-1.5 text-[22px] font-semibold"
              style={{
                color: "var(--color-foreground)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              {fmtCost(totalCost)}
            </div>
            <div
              className="text-[11.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              {fmtNum(totalRequests)} requests — passthrough to provider
            </div>
          </div>
        </div>
      </AcctSection>

      <AcctSection
        title="Token breakdown"
        desc="Usage by token type since last metrics reset."
      >
        <div className="flex flex-col">
          {[
            {
              label: "Input tokens",
              value: fmtNum(inputTokens),
              cost: fmtCost(inputCost),
              rate: "$3.00 / MTok",
            },
            {
              label: "Output tokens",
              value: fmtNum(outputTokens),
              cost: fmtCost(outputCost),
              rate: "$15.00 / MTok",
            },
            {
              label: "Total",
              value: fmtNum(inputTokens + outputTokens),
              cost: fmtCost(totalCost),
              rate: "",
              bold: true,
            },
          ].map((row, i, arr) => (
            <div
              key={row.label}
              className="grid items-center gap-2.5 px-1 py-2.5"
              style={{
                gridTemplateColumns: "140px 120px 90px 1fr",
                borderBottom:
                  i === arr.length - 1
                    ? "none"
                    : "1px solid var(--oc-border)",
                fontSize: 12,
                fontFamily: "var(--oc-mono)",
              }}
            >
              <span
                style={{
                  color: "var(--color-foreground)",
                  fontWeight: row.bold ? 600 : 400,
                }}
              >
                {row.label}
              </span>
              <span style={{ color: "var(--oc-text-dim)" }}>{row.value}</span>
              <span style={{ color: "var(--oc-text-dim)" }}>{row.cost}</span>
              <span
                className="text-right"
                style={{ color: "var(--oc-text-muted)", fontSize: 11 }}
              >
                {row.rate}
              </span>
            </div>
          ))}
        </div>
      </AcctSection>
    </>
  );
}
