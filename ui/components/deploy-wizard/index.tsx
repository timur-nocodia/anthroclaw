"use client";

import { useCallback, useState } from "react";
import { Check, Loader2, X, Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  type DeployConfig,
  DEFAULT_CONFIG,
  WIZARD_STEPS,
} from "./types";
import { StepIdentity } from "./step-identity";
import { StepTarget } from "./step-target";
import { StepNetworking } from "./step-networking";
import { StepRelease } from "./step-release";
import { StepAgents } from "./step-agents";
import { StepPolicies } from "./step-policies";
import { StepReview } from "./step-review";
import { toDeployPayload } from "./payload";

/* ------------------------------------------------------------------ */
/*  Deploy execution progress                                          */
/* ------------------------------------------------------------------ */

interface DeployStep {
  label: string;
  status: "pending" | "running" | "success" | "error";
  elapsed?: number;
  message?: string;
}

type DeployStreamEvent =
  | {
      type: "step";
      index: number;
      total: number;
      label: string;
      status: "running" | "done" | "error";
      elapsed?: number;
      message?: string;
    }
  | { type: "done"; url: string; credentials: { email: string; note: string } }
  | { type: "error"; step: number; message: string };

type DryRunResponse = {
  checks?: Array<{ name: string; status: "pass" | "fail" | "warn"; message: string }>;
  canDeploy?: boolean;
  message?: string;
};

const DEPLOY_STEPS_TEMPLATE: { label: string }[] = [
  { label: "Running dry-run checks" },
  { label: "Connecting via SSH" },
  { label: "Installing Node.js 22" },
  { label: "Installing pnpm" },
  { label: "Cloning repository" },
  { label: "Installing dependencies" },
  { label: "Configuring .env and config.yml" },
  { label: "Setting up systemd service + Caddy" },
  { label: "Starting gateway and verifying health" },
];

/* ------------------------------------------------------------------ */
/*  DeployWizard                                                       */
/* ------------------------------------------------------------------ */

interface DeployWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeployWizard({ open, onOpenChange }: DeployWizardProps) {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<DeployConfig>({ ...DEFAULT_CONFIG });
  const [deploying, setDeploying] = useState(false);
  const [deploySteps, setDeploySteps] = useState<DeployStep[]>([]);
  const [deployDone, setDeployDone] = useState(false);

  /* ---- Config updater ---- */
  const updateConfig = useCallback(
    <K extends keyof DeployConfig>(key: K, value: DeployConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  /* ---- Reset when dialog opens ---- */
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setStep(0);
      setConfig({ ...DEFAULT_CONFIG });
      setDeploying(false);
      setDeploySteps([]);
      setDeployDone(false);
    }
    onOpenChange(isOpen);
  };

  /* ---- Navigate steps ---- */
  const canNext = step < WIZARD_STEPS.length - 1;
  const goNext = () => {
    if (canNext) setStep(step + 1);
  };
  const goBack = () => {
    if (step > 0) setStep(step - 1);
  };

  /* ---- Deploy execution ---- */
  const executeDeploy = useCallback(async () => {
    setDeploying(true);
    const steps: DeployStep[] = DEPLOY_STEPS_TEMPLATE.map((s) => ({
      label: s.label,
      status: "pending",
    }));
    setDeploySteps([...steps]);

    try {
      const payload = toDeployPayload(config);
      setDeploySteps((prev) =>
        prev.map((s, idx) =>
          idx === 0 ? { ...s, status: "running" } : s,
        ),
      );

      const dryRunRes = await fetch("/api/fleet/deploy/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const dryRun = await dryRunRes.json().catch(() => null) as DryRunResponse | null;

      if (!dryRunRes.ok) {
        const message = dryRun?.message ?? `Dry-run failed: HTTP ${dryRunRes.status}`;
        setDeploySteps((prev) =>
          prev.map((s, idx) =>
            idx === 0 ? { ...s, status: "error", message } : s,
          ),
        );
        return;
      }

      const failedCheck = dryRun?.checks?.find((check) => check.status === "fail");
      if (dryRun?.canDeploy === false || failedCheck) {
        const message = failedCheck
          ? `${failedCheck.name}: ${failedCheck.message}`
          : "Dry-run checks failed";
        setDeploySteps((prev) =>
          prev.map((s, idx) =>
            idx === 0 ? { ...s, status: "error", message } : s,
          ),
        );
        return;
      }

      const warnCount = dryRun?.checks?.filter((check) => check.status === "warn").length ?? 0;
      setDeploySteps((prev) =>
        prev.map((s, idx) =>
          idx === 0
            ? {
                ...s,
                status: "success",
                message: warnCount > 0 ? `${warnCount} warning${warnCount === 1 ? "" : "s"}` : undefined,
              }
            : s,
        ),
      );

      const res = await fetch("/api/fleet/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as DeployStreamEvent;
              if (event.type === "step") {
                const stepIndex = event.index;
                setDeploySteps((prev) =>
                  prev.map((s, i) =>
                    i === stepIndex
                      ? {
                          ...s,
                          label: event.label || s.label,
                          status: event.status === "done" ? "success" : event.status,
                          elapsed: event.elapsed,
                          message: event.message,
                        }
                      : s,
                  ),
                );
              } else if (event.type === "done") {
                setDeployDone(true);
              } else if (event.type === "error") {
                const stepIndex = event.step;
                setDeploySteps((prev) =>
                  prev.map((s, i) =>
                    i === stepIndex
                      ? { ...s, status: "error", message: event.message }
                      : s.status === "running"
                        ? { ...s, status: "error", message: event.message }
                        : s,
                  ),
                );
              }
            } catch {
              // skip malformed
            }
          }
        }
        return;
      }

      const body = await res.json().catch(() => null) as { message?: string } | null;
      const message = body?.message ?? `Deploy request failed: HTTP ${res.status}`;
      setDeploySteps((prev) =>
        prev.map((s, idx) =>
          idx === 1 ? { ...s, status: "error", message } : s,
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Deploy request failed";
      setDeploySteps((prev) =>
        prev.map((s, idx) =>
          (s.status === "running" || idx === 0) ? { ...s, status: "error", message } : s,
        ),
      );
    }
  }, [config]);

  const stepProps = { config, updateConfig };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex h-[95vh] w-full max-w-[100vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[100vw] sm:rounded-none"
        style={{
          background: "var(--oc-bg0)",
          border: "none",
        }}
      >
        {/* ---- Header ---- */}
        <div
          className="flex items-center gap-4 border-b px-6 py-3.5"
          style={{
            background: "var(--oc-bg1)",
            borderColor: "var(--oc-border)",
          }}
        >
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md"
            style={{
              background: "var(--oc-accent-soft)",
              border: "1px solid var(--oc-accent-ring)",
            }}
          >
            <Zap
              className="h-[14px] w-[14px]"
              style={{ color: "var(--oc-accent)" }}
            />
          </div>
          <div className="flex-1">
            <DialogTitle
              className="text-[14px] font-semibold"
              style={{ color: "var(--color-foreground)" }}
            >
              Deploy gateway
            </DialogTitle>
            <DialogDescription
              className="mt-px text-[11.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Provision a new AnthroClaw gateway and join it to this fleet.
            </DialogDescription>
          </div>
          <span
            className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: "var(--oc-bg2)",
              color: "var(--oc-text-dim)",
              border: "1px solid var(--oc-border)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {config.name || "unnamed"}
          </span>
          <button
            onClick={() => handleOpenChange(false)}
            className="inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-[5px] px-2.5 text-xs font-medium"
            style={{
              background: "transparent",
              color: "var(--oc-text-dim)",
              border: "1px solid var(--oc-border)",
              fontFamily: "inherit",
            }}
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>

        {/* ---- Stepper rail ---- */}
        {!deploying && (
          <div
            className="flex items-center border-b px-6 py-3.5"
            style={{
              borderColor: "var(--oc-border)",
              background: "var(--oc-bg0)",
            }}
          >
            {WIZARD_STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <div
                  key={s.id}
                  onClick={() => setStep(i)}
                  className="flex flex-1 cursor-pointer items-center gap-2.5 pr-2 py-1"
                  style={{
                    borderRight:
                      i === WIZARD_STEPS.length - 1
                        ? "none"
                        : "1px solid var(--oc-border)",
                    opacity: i > step ? 0.55 : 1,
                  }}
                >
                  {/* Step circle */}
                  <span
                    className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                    style={{
                      background: done
                        ? "var(--oc-accent)"
                        : active
                          ? "transparent"
                          : "var(--oc-bg2)",
                      border: active
                        ? "1.5px solid var(--oc-accent)"
                        : `1px solid ${done ? "var(--oc-accent)" : "var(--oc-border)"}`,
                      color: done
                        ? "var(--oc-bg0)"
                        : active
                          ? "var(--oc-accent)"
                          : "var(--oc-text-muted)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    {done ? "\u2713" : i + 1}
                  </span>
                  {/* Label */}
                  <div className="flex min-w-0 flex-col gap-px">
                    <span
                      className="whitespace-nowrap text-[12px] font-medium"
                      style={{
                        color: active
                          ? "var(--color-foreground)"
                          : done
                            ? "var(--oc-text-dim)"
                            : "var(--oc-text-muted)",
                      }}
                    >
                      {s.id}
                    </span>
                    <span
                      className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px]"
                      style={{ color: "var(--oc-text-muted)" }}
                    >
                      {s.hint}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ---- Body ---- */}
        <div className="flex flex-1 justify-center overflow-auto px-6 py-7">
          <div className="flex w-full max-w-[720px] flex-col gap-4">
            {!deploying && (
              <>
                {step === 0 && <StepIdentity {...stepProps} />}
                {step === 1 && <StepTarget {...stepProps} />}
                {step === 2 && <StepNetworking {...stepProps} />}
                {step === 3 && <StepRelease {...stepProps} />}
                {step === 4 && <StepAgents {...stepProps} />}
                {step === 5 && <StepPolicies {...stepProps} />}
                {step === 6 && <StepReview {...stepProps} />}
              </>
            )}

            {/* ---- Deploy progress ---- */}
            {deploying && (
              <div className="flex flex-col gap-4">
                <div
                  className="text-[14px] font-semibold"
                  style={{ color: "var(--color-foreground)" }}
                >
                  Deploying {config.name || "gateway"}...
                </div>

                <div
                  className="flex flex-col rounded-md"
                  style={{
                    background: "var(--oc-bg1)",
                    border: "1px solid var(--oc-border)",
                  }}
                >
                  {deploySteps.map((ds, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-4 py-3"
                      style={{
                        borderBottom:
                          i === deploySteps.length - 1
                            ? "none"
                            : "1px solid var(--oc-border)",
                      }}
                    >
                      {/* Status icon */}
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                        {ds.status === "pending" && (
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ background: "var(--oc-text-muted)" }}
                          />
                        )}
                        {ds.status === "running" && (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            style={{ color: "var(--oc-accent)" }}
                          />
                        )}
                        {ds.status === "success" && (
                          <Check
                            className="h-4 w-4"
                            style={{ color: "var(--oc-green)" }}
                          />
                        )}
                        {ds.status === "error" && (
                          <X
                            className="h-4 w-4"
                            style={{ color: "var(--oc-red)" }}
                          />
                        )}
                      </div>

                      {/* Step label */}
                      <span
                        className="text-[12.5px]"
                        style={{
                          color:
                            ds.status === "success"
                              ? "var(--color-foreground)"
                              : ds.status === "running"
                                ? "var(--oc-accent)"
                                : "var(--oc-text-muted)",
                          fontFamily: "var(--oc-mono)",
                        }}
                      >
                        [{i + 1}/{deploySteps.length}] {ds.label}
                      </span>

                      <div className="flex-1" />

                      {/* Status text */}
                      <span
                        className="text-[11px]"
                        style={{
                          color:
                            ds.status === "success"
                              ? "var(--oc-green)"
                              : ds.status === "running"
                                ? "var(--oc-text-muted)"
                                : "var(--oc-text-muted)",
                          fontFamily: "var(--oc-mono)",
                        }}
                      >
                        {ds.status === "success" &&
                          `\u2713  ${ds.elapsed ? `${Math.round(ds.elapsed / 1000)}s` : "done"}`}
                        {ds.status === "running" && "running..."}
                        {ds.status === "error" && (ds.message ?? "failed")}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Deploy success banner */}
                {deployDone && (
                  <div
                    className="flex flex-col gap-3 rounded-md p-4"
                    style={{
                      background: "rgba(74,222,128,0.08)",
                      border: "1px solid rgba(74,222,128,0.3)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Check
                        className="h-5 w-5"
                        style={{ color: "var(--oc-green)" }}
                      />
                      <span
                        className="text-[14px] font-semibold"
                        style={{ color: "var(--color-foreground)" }}
                      >
                        Gateway deployed successfully
                      </span>
                    </div>
                    {config.domain && (
                      <div
                        className="text-[12px]"
                        style={{
                          color: "var(--oc-text-muted)",
                          fontFamily: "var(--oc-mono)",
                        }}
                      >
                        URL: https://{config.domain}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOpenChange(false)}
                        className="inline-flex h-[28px] cursor-pointer items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium"
                        style={{
                          background: "var(--oc-accent)",
                          color: "var(--oc-bg0)",
                          border: "1px solid var(--oc-accent)",
                          fontFamily: "inherit",
                        }}
                      >
                        Back to Fleet
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ---- Footer ---- */}
        {!deploying && (
          <div
            className="flex items-center gap-2 border-t px-6 py-3"
            style={{
              background: "var(--oc-bg1)",
              borderColor: "var(--oc-border)",
            }}
          >
            <span
              className="text-[11.5px]"
              style={{
                color: "var(--oc-text-muted)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              Step {step + 1} of {WIZARD_STEPS.length} &middot;{" "}
              {WIZARD_STEPS[step].id}
            </span>
            <div className="flex-1" />
            {step > 0 && (
              <button
                onClick={goBack}
                className="inline-flex h-[28px] cursor-pointer items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--color-foreground)",
                  border: "1px solid var(--oc-border)",
                  fontFamily: "inherit",
                }}
              >
                Back
              </button>
            )}
            {canNext ? (
              <button
                onClick={goNext}
                className="inline-flex h-[28px] cursor-pointer items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium"
                style={{
                  background: "var(--oc-accent)",
                  color: "var(--oc-bg0)",
                  border: "1px solid var(--oc-accent)",
                  fontFamily: "inherit",
                }}
              >
                Continue
              </button>
            ) : (
              <button
                onClick={executeDeploy}
                className="inline-flex h-[28px] cursor-pointer items-center gap-1.5 rounded-[5px] px-3 text-[12px] font-medium"
                style={{
                  background: "var(--oc-accent)",
                  color: "var(--oc-bg0)",
                  border: "1px solid var(--oc-accent)",
                  fontFamily: "inherit",
                }}
              >
                <Zap className="h-3.5 w-3.5" />
                Run dry-run &amp; deploy
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
