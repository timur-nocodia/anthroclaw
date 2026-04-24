"use client";

import { Shield } from "lucide-react";
import type { StepProps } from "./types";

/* ------------------------------------------------------------------ */
/*  Review line                                                        */
/* ------------------------------------------------------------------ */

function ReviewLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: "130px 1fr" }}>
      <span style={{ color: "var(--oc-text-muted)" }}>{k}</span>
      <span style={{ color: "var(--color-foreground)" }}>{v}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  StepReview                                                         */
/* ------------------------------------------------------------------ */

export function StepReview({ config }: StepProps) {
  return (
    <>
      <div
        className="rounded-md p-3.5 text-[12px] leading-[1.9]"
        style={{
          background: "var(--oc-bg0)",
          border: "1px solid var(--oc-border)",
          fontFamily: "var(--oc-mono)",
        }}
      >
        <ReviewLine k="Name" v={config.name || "(unnamed)"} />
        <ReviewLine k="Environment" v={config.environment} />
        <ReviewLine k="Region" v={config.region || "\u2014"} />
        <ReviewLine k="City" v={config.city || "\u2014"} />
        <ReviewLine k="Deploy mode" v={config.mode} />
        {config.mode === "ssh" && (
          <ReviewLine
            k="Target"
            v={`${config.user}@${config.host}:${config.port}`}
          />
        )}
        <ReviewLine k="Domain" v={config.domain || "(none)"} />
        <ReviewLine k="TLS" v={config.tls} />
        <ReviewLine k="HTTP port" v={String(config.httpPort)} />
        <ReviewLine k="Webhook mode" v={config.webhookMode} />
        <ReviewLine
          k="Release"
          v={
            config.channel +
            (config.channel === "pin" ? ` \u2192 ${config.version}` : "")
          }
        />
        <ReviewLine k="Upgrade policy" v={config.upgradePolicy} />
        <ReviewLine
          k="Agent source"
          v={config.agentSource}
        />
        <ReviewLine
          k="Agents"
          v={config.agents.length > 0 ? config.agents.join(", ") : "\u2014"}
        />
        <ReviewLine k="Backups" v={config.backupSchedule} />
        <ReviewLine
          k="Monitoring"
          v={config.monitoring ? "enabled" : "off"}
        />
        <ReviewLine k="Log retention" v={config.logRetention} />
        <ReviewLine k="Max media" v={`${config.maxMediaGB} GB`} />
      </div>

      {/* Dry-run banner */}
      <div
        className="flex items-start gap-2.5 rounded-md p-3"
        style={{
          background: "rgba(74,222,128,0.08)",
          border: "1px solid rgba(74,222,128,0.3)",
        }}
      >
        <Shield
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: "var(--oc-green)" }}
        />
        <div>
          <div
            className="text-[12.5px] font-semibold"
            style={{ color: "var(--color-foreground)" }}
          >
            Dry-run will execute first
          </div>
          <div
            className="mt-0.5 text-[11px] leading-relaxed"
            style={{ color: "var(--oc-text-muted)" }}
          >
            Before any real changes, we&apos;ll SSH in and verify reachability,
            dependencies, disk, and port availability. Nothing is installed until
            you confirm the plan.
          </div>
        </div>
      </div>
    </>
  );
}
