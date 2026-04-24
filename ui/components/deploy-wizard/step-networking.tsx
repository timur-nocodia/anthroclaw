"use client";

import type { StepProps } from "./types";
import { Field, WizardInput, Segmented } from "./field";

const INBOUND_PORTS = [
  { port: 443, desc: "HTTPS \u00b7 channel webhooks" },
  { port: 8443, desc: "Control API" },
  { port: 9090, desc: "Prometheus /metrics" },
  { port: 80, desc: "HTTP \u2192 redirect to HTTPS" },
  { port: 3000, desc: "Direct (dev)" },
];

export function StepNetworking({ config, updateConfig }: StepProps) {
  const togglePort = (port: number) => {
    const current = config.inboundPorts;
    if (current.includes(port)) {
      updateConfig(
        "inboundPorts",
        current.filter((p) => p !== port),
      );
    } else {
      updateConfig("inboundPorts", [...current, port]);
    }
  };

  return (
    <>
      <Field
        label="Public domain"
        hint="Gateway will serve channel webhooks and the control API at this host."
      >
        <WizardInput
          value={config.domain}
          onChange={(v) => updateConfig("domain", v)}
          placeholder="gw-prod-jp.internal.example"
          mono
        />
      </Field>

      <Field label="HTTP port" hint="Internal port for the Next.js server.">
        <WizardInput
          value={config.httpPort}
          onChange={(v) => updateConfig("httpPort", parseInt(v) || 3000)}
          mono
        />
      </Field>

      <Field label="TLS">
        <Segmented
          value={config.tls}
          onChange={(v) => updateConfig("tls", v)}
          options={[
            { value: "letsencrypt", label: "Let's Encrypt (auto)" },
            { value: "custom", label: "Upload custom cert" },
            { value: "none", label: "Terminate upstream" },
          ]}
        />
      </Field>

      <Field label="Inbound ports">
        <div className="grid grid-cols-3 gap-2">
          {INBOUND_PORTS.map(({ port, desc }) => {
            const active = config.inboundPorts.includes(port);
            return (
              <label
                key={port}
                className="flex cursor-pointer items-start gap-2 rounded-[5px] p-2.5"
                style={{
                  background: active ? "var(--oc-bg2)" : "var(--oc-bg0)",
                  border: `1px solid ${active ? "rgba(110,231,183,0.3)" : "var(--oc-border)"}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => togglePort(port)}
                  className="mt-0.5"
                  style={{ accentColor: "var(--oc-accent)" }}
                />
                <div>
                  <div
                    className="text-[13px] font-semibold"
                    style={{
                      color: "var(--color-foreground)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    :{port}
                  </div>
                  <div
                    className="mt-0.5 text-[11px]"
                    style={{ color: "var(--oc-text-muted)" }}
                  >
                    {desc}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Field>

      <Field
        label="Webhook mode"
        hint="Webhook mode is recommended for production. Long polling is simpler for dev."
      >
        <Segmented
          value={config.webhookMode}
          onChange={(v) => updateConfig("webhookMode", v)}
          options={[
            { value: "longpoll", label: "Long polling" },
            { value: "webhook", label: "Webhook" },
          ]}
        />
      </Field>
    </>
  );
}
