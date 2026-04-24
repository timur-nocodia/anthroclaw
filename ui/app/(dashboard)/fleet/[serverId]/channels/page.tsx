"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { StatusIndicator, type ConnectionStatus } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface TelegramAccount {
  accountId: string;
  botUsername: string;
  status: string;
  agents?: string[];
}

interface WhatsAppAccount {
  accountId: string;
  phone: string;
  status: string;
  agent?: string;
}

interface GatewayChannels {
  telegram?: TelegramAccount[];
  whatsapp?: WhatsAppAccount[];
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export default function ChannelsPage() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.serverId as string;

  const [channels, setChannels] = useState<GatewayChannels>({});
  const [loading, setLoading] = useState(true);

  const fetchChannels = useCallback(async () => {
    try {
      const gwRes = await fetch(`/api/fleet/${serverId}/gateway/status`);
      if (gwRes.ok) {
        const d = await gwRes.json();
        setChannels(d.channels ?? {});
        setLoading(false);
        return;
      }
    } catch {
      // gateway unavailable — fall through to config fallback
    }

    try {
      const [cfgRes, agentsRes] = await Promise.all([
        fetch(`/api/fleet/${serverId}/config`),
        fetch(`/api/fleet/${serverId}/agents`),
      ]);
      const cfgData = cfgRes.ok ? await cfgRes.json() : null;
      const agentsData = agentsRes.ok ? await agentsRes.json() : [];
      const agents: Array<{ id: string; routes?: Array<{ channel: string; account?: string }> }> =
        Array.isArray(agentsData) ? agentsData : agentsData.agents ?? [];

      const tgAccounts: TelegramAccount[] = [];
      const waAccounts: WhatsAppAccount[] = [];

      if (cfgData?.raw) {
        const lines = (cfgData.raw as string).split("\n");
        let inTelegram = false;
        let inWhatsapp = false;
        let inAccounts = false;

        for (const line of lines) {
          if (/^telegram:/.test(line)) { inTelegram = true; inWhatsapp = false; inAccounts = false; continue; }
          if (/^whatsapp:/.test(line)) { inWhatsapp = true; inTelegram = false; inAccounts = false; continue; }
          if (/^\S/.test(line)) { inTelegram = false; inWhatsapp = false; inAccounts = false; continue; }
          if (/^\s+accounts:/.test(line)) { inAccounts = true; continue; }
          const accountMatch = line.match(/^\s{4}(\S+):/);
          if (accountMatch && inAccounts) {
            const accountId = accountMatch[1];
            const channelType = inTelegram ? "telegram" : "whatsapp";
            const boundAgents = agents
              .filter((a) => a.routes?.some((r) =>
                r.channel === channelType &&
                (!r.account || r.account === accountId),
              ))
              .map((a) => a.id);
            if (inTelegram) {
              tgAccounts.push({
                accountId,
                botUsername: `@${accountId}`,
                status: "configured",
                agents: boundAgents,
              });
            } else if (inWhatsapp) {
              waAccounts.push({
                accountId,
                phone: accountId,
                status: "configured",
              });
            }
          }
        }
      }

      setChannels({ telegram: tgAccounts, whatsapp: waAccounts });
    } catch {
      // both methods failed
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const tg = channels.telegram ?? [];
  const wa = channels.whatsapp ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <div>
          <h1 className="text-[15px] font-semibold" style={{ color: "var(--color-foreground)" }}>
            Channels
          </h1>
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
            Telegram bots and WhatsApp accounts. Bind agents to channels here.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Docs
          </Button>
          <Button
            size="sm"
            onClick={() =>
              router.push(`/fleet/${serverId}/channels/whatsapp/pair`)
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Pair WhatsApp
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3.5 overflow-auto p-5">
        {/* Telegram */}
        <div
          className="overflow-hidden rounded-md"
          style={{
            background: "var(--oc-bg1)",
            border: "1px solid var(--oc-border)",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2.5"
            style={{ borderBottom: "1px solid var(--oc-border)" }}
          >
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--color-foreground)", letterSpacing: "0.2px" }}
            >
              Telegram
            </span>
            <span
              className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--oc-border)",
                color: "var(--oc-text-muted)",
              }}
            >
              tokens in config.yml
            </span>
          </div>
          {loading && (
            <div
              className="grid items-center gap-3 px-3.5 py-3"
              style={{ gridTemplateColumns: "1fr 200px 120px" }}
            >
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--oc-bg3)" }} />
                <div className="flex flex-col gap-1.5">
                  <div className="h-3 w-32 animate-pulse rounded" style={{ background: "var(--oc-bg3)" }} />
                  <div className="h-2.5 w-44 animate-pulse rounded" style={{ background: "var(--oc-bg3)", opacity: 0.6 }} />
                </div>
              </div>
              <div className="h-3 w-16 animate-pulse rounded" style={{ background: "var(--oc-bg3)" }} />
              <div />
            </div>
          )}
          {tg.map((c, i) => (
            <div
              key={c.accountId}
              className="grid items-center gap-3 px-3.5 py-3"
              style={{
                gridTemplateColumns: "1fr 200px 120px",
                borderBottom:
                  i === tg.length - 1 ? "none" : "1px solid var(--oc-border)",
              }}
            >
              <div className="flex items-center gap-2.5">
                <StatusIndicator status="connected" />
                <div>
                  <div
                    className="text-[13px] font-medium"
                    style={{
                      color: "var(--color-foreground)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    {c.botUsername}
                  </div>
                  <div
                    className="text-[11px]"
                    style={{
                      color: "var(--oc-text-muted)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    {c.accountId} &middot; long-polling
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {(c.agents ?? []).map((a) => (
                  <span
                    key={a}
                    className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid var(--oc-border)",
                      color: "var(--oc-text-dim)",
                    }}
                  >
                    {a}
                  </span>
                ))}
              </div>
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push(`/fleet/${serverId}/agents?channel=${c.accountId}`)}
                >
                  <Pencil className="h-3 w-3" />
                  Routes
                </Button>
              </div>
            </div>
          ))}
          {tg.length === 0 && !loading && (
            <div className="p-8 text-center text-xs" style={{ color: "var(--oc-text-muted)" }}>
              No Telegram accounts configured.
            </div>
          )}
        </div>

        {/* WhatsApp */}
        <div
          className="overflow-hidden rounded-md"
          style={{
            background: "var(--oc-bg1)",
            border: "1px solid var(--oc-border)",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-2.5"
            style={{ borderBottom: "1px solid var(--oc-border)" }}
          >
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--color-foreground)", letterSpacing: "0.2px" }}
            >
              WhatsApp
            </span>
          </div>
          {loading && (
            <div
              className="grid items-center gap-3 px-3.5 py-3"
              style={{ gridTemplateColumns: "1fr 200px 120px" }}
            >
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--oc-bg3)" }} />
                <div className="flex flex-col gap-1.5">
                  <div className="h-3 w-28 animate-pulse rounded" style={{ background: "var(--oc-bg3)" }} />
                  <div className="h-2.5 w-36 animate-pulse rounded" style={{ background: "var(--oc-bg3)", opacity: 0.6 }} />
                </div>
              </div>
              <div className="h-3 w-16 animate-pulse rounded" style={{ background: "var(--oc-bg3)" }} />
              <div />
            </div>
          )}
          {wa.map((c, i) => {
            const status: ConnectionStatus =
              c.status === "connected"
                ? "connected"
                : c.status === "reconnecting"
                  ? "reconnecting"
                  : "disconnected";
            return (
              <div
                key={c.accountId}
                className="grid items-center gap-3 px-3.5 py-3"
                style={{
                  gridTemplateColumns: "1fr 200px 120px",
                  borderBottom:
                    i === wa.length - 1
                      ? "none"
                      : "1px solid var(--oc-border)",
                }}
              >
                <div className="flex items-center gap-2.5">
                  <StatusIndicator status={status} />
                  <div>
                    <div
                      className="text-[13px] font-medium"
                      style={{
                        color: "var(--color-foreground)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {c.phone}
                    </div>
                    <div
                      className="text-[11px]"
                      style={{
                        color:
                          c.status === "connected"
                            ? "var(--oc-text-muted)"
                            : "var(--oc-yellow)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {c.accountId} &middot; {c.status}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.agent && (
                    <span
                      className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid var(--oc-border)",
                        color: "var(--oc-text-dim)",
                      }}
                    >
                      {c.agent} &middot; any
                    </span>
                  )}
                </div>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm">
                    <Pencil className="h-3 w-3" />
                    Bind
                  </Button>
                  <button
                    className="inline-flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--oc-bg3)]"
                    style={{ color: "var(--oc-text-dim)" }}
                    title="Disconnect"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
          {wa.length === 0 && !loading && (
            <div className="p-8 text-center text-xs" style={{ color: "var(--oc-text-muted)" }}>
              No WhatsApp accounts configured.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
