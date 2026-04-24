"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { StepProps } from "./types";
import { Field, WizardInput, Segmented, ModeCard } from "./field";
import { toDeployPayload } from "./payload";

export function StepTarget({ config, updateConfig }: StepProps) {
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestMessage("");

    if (!config.host || !config.user) {
      setTestStatus("error");
      setTestMessage("Connection failed: Host and user are required");
      return;
    }

    try {
      const res = await fetch("/api/fleet/deploy/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toDeployPayload(config)),
      });
      const body = await res.json().catch(() => null) as {
        checks?: Array<{ name: string; status: "pass" | "fail" | "warn"; message: string }>;
        message?: string;
      } | null;

      if (!res.ok) {
        throw new Error(body?.message ?? `Dry-run failed: HTTP ${res.status}`);
      }

      const failed = body?.checks?.find((check) => check.status === "fail");
      if (failed) {
        setTestStatus("error");
        setTestMessage(`${failed.name}: ${failed.message}`);
        return;
      }

      const ssh = body?.checks?.find((check) => check.name === "SSH connectivity");
      setTestStatus("success");
      setTestMessage(ssh?.message ?? `Connected as ${config.user}@${config.host}`);
    } catch (err: unknown) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : "Connection test failed");
    }
  };

  return (
    <>
      <Field label="Deploy mode">
        <div className="grid grid-cols-3 gap-2.5">
          <ModeCard
            active={config.mode === "ssh"}
            onClick={() => updateConfig("mode", "ssh")}
            title="SSH install"
            desc="Runs install.sh on a Linux host over SSH."
          />
          <ModeCard
            active={config.mode === "docker"}
            onClick={() => updateConfig("mode", "docker")}
            title="Docker"
            desc="Pull anthroclaw/gateway image and run."
            disabled
          />
          <ModeCard
            active={config.mode === "k8s"}
            onClick={() => updateConfig("mode", "k8s")}
            title="Kubernetes"
            desc="Helm chart via your configured kubeconfig."
            disabled
          />
        </div>
      </Field>

      {config.mode === "ssh" && (
        <>
          <div className="grid grid-cols-[1fr_1fr_110px] gap-3">
            <Field label="Host / IP">
              <WizardInput
                value={config.host}
                onChange={(v) => updateConfig("host", v)}
                placeholder="10.0.14.22"
                mono
              />
            </Field>
            <Field label="Username">
              <WizardInput
                value={config.user}
                onChange={(v) => updateConfig("user", v)}
                placeholder="root"
                mono
              />
            </Field>
            <Field label="Port">
              <WizardInput
                value={config.port}
                onChange={(v) => updateConfig("port", parseInt(v) || 22)}
                mono
              />
            </Field>
          </div>

          <Field label="Authentication">
            <Segmented
              value={config.auth}
              onChange={(v) => updateConfig("auth", v)}
              options={[
                { value: "key", label: "SSH key (agent-forwarded)" },
                { value: "password", label: "Password" },
              ]}
            />
          </Field>

          {config.auth === "key" && (
            <Field
              label="SSH private key"
              hint="This key is stored encrypted and used only for deployments."
            >
              <textarea
                value={config.sshKey}
                onChange={(e) => updateConfig("sshKey", e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                rows={4}
                className="w-full rounded-[5px] px-2.5 py-2 text-[12px] outline-none"
                style={{
                  background: "var(--oc-bg0)",
                  border: "1px solid var(--oc-border)",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--oc-mono)",
                  resize: "vertical",
                }}
              />
            </Field>
          )}

          {config.auth === "password" && (
            <Field label="Password">
              <WizardInput
                value={config.password}
                onChange={(v) => updateConfig("password", v)}
                type="password"
                placeholder="Enter password"
              />
            </Field>
          )}

          {/* Command preview */}
          <div
            className="rounded-[5px] p-2.5 text-[11.5px] leading-relaxed"
            style={{
              background: "var(--oc-bg0)",
              border: "1px solid var(--oc-border)",
              color: "var(--oc-text-muted)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            &rarr; will run:{" "}
            <span style={{ color: "var(--oc-accent)" }}>
              ssh {config.user || "root"}@{config.host || "host"} -p{" "}
              {config.port} &apos;bash -s&apos; &lt;
              /opt/anthroclaw/install.sh --name={config.name || "unnamed"}{" "}
              --env={config.environment}
            </span>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleTestConnection}
              disabled={testStatus === "testing"}
              className="inline-flex h-[28px] cursor-pointer items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium"
              style={{
                background: "rgba(255,255,255,0.06)",
                color: "var(--color-foreground)",
                border: "1px solid var(--oc-border)",
                fontFamily: "inherit",
              }}
            >
              {testStatus === "testing" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Test Connection
            </button>
            {testStatus === "success" && (
              <div className="flex items-center gap-1.5">
                <Check
                  className="h-3.5 w-3.5"
                  style={{ color: "var(--oc-green)" }}
                />
                <span
                  className="text-[11px]"
                  style={{
                    color: "var(--oc-green)",
                    fontFamily: "var(--oc-mono)",
                  }}
                >
                  {testMessage}
                </span>
              </div>
            )}
            {testStatus === "error" && (
              <div className="flex items-center gap-1.5">
                <X
                  className="h-3.5 w-3.5"
                  style={{ color: "var(--oc-red)" }}
                />
                <span
                  className="text-[11px]"
                  style={{
                    color: "var(--oc-red)",
                    fontFamily: "var(--oc-mono)",
                  }}
                >
                  {testMessage}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
