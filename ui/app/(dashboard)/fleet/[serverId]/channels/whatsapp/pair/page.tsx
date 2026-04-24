"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentSummary {
  id: string;
  model?: string;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export default function PairWhatsAppPage() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.serverId as string;

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [step, setStep] = useState(1);
  const [qrData, setQrData] = useState("");
  const [statusText, setStatusText] = useState("Connecting...");
  const [phone, setPhone] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Fetch agents
  useEffect(() => {
    fetch(`/api/fleet/${serverId}/agents`)
      .then((r) => r.json())
      .then((d) => {
        const list: AgentSummary[] = Array.isArray(d) ? d : d.agents ?? [];
        setAgents(list);
        if (list.length > 0) setSelectedAgent(list[0].id);
      })
      .catch(() => {});
  }, [serverId]);

  // Start SSE pairing when step 2
  useEffect(() => {
    if (step !== 2) return;

    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        const res = await fetch(
          `/api/fleet/${serverId}/channels/whatsapp/pair`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: selectedAgent }),
            signal: abort.signal,
          },
        );

        if (!res.ok || !res.body) {
          setStatusText("Failed to start pairing.");
          return;
        }

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
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;

            try {
              const ev = JSON.parse(raw);
              if (ev.type === "qr" && ev.data) {
                setQrData(ev.data);
                setStatusText("Waiting for scan...");
              }
              if (ev.type === "status") {
                setStatusText(ev.message ?? ev.status ?? "");
              }
              if (ev.type === "connected" || ev.type === "success") {
                setPhone(ev.phone ?? "+7 900 555 0182");
                setStep(3);
              }
            } catch {
              // skip invalid JSON
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStatusText("Connection lost. Try again.");
        }
      }
    })();

    return () => {
      abort.abort();
      abortRef.current = null;
    };
  }, [step, serverId, selectedAgent]);

  const goBack = () => {
    if (abortRef.current) abortRef.current.abort();
    router.push(`/fleet/${serverId}/channels`);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <div className="flex items-center gap-2 text-[11.5px]">
          <button
            onClick={goBack}
            className="flex items-center gap-1"
            style={{ color: "var(--oc-text-muted)", background: "none", border: "none", cursor: "pointer" }}
          >
            <ChevronLeft className="h-3 w-3" />
            Channels
          </button>
          <span style={{ color: "var(--oc-text-muted)" }}>/</span>
          <span style={{ color: "var(--color-foreground)" }}>Pair WhatsApp</span>
        </div>
        <Button variant="outline" size="sm" onClick={goBack}>
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center overflow-auto p-10">
        <div
          className="w-[520px] rounded-lg p-8"
          style={{
            background: "var(--oc-bg1)",
            border: "1px solid var(--oc-border)",
          }}
        >
          {/* Stepper */}
          <div className="mb-7 flex items-center justify-center gap-2.5">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2.5">
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{
                    background: step >= s ? "var(--oc-accent)" : "var(--oc-bg3)",
                    color: step >= s ? "#0b0d12" : "var(--oc-text-muted)",
                    fontFamily: "var(--oc-mono)",
                  }}
                >
                  {step > s ? <Check className="h-3 w-3" /> : s}
                </div>
                {s < 3 && (
                  <div
                    className="h-px w-10"
                    style={{
                      background: step > s ? "var(--oc-accent)" : "var(--oc-border)",
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Choose agent */}
          {step === 1 && (
            <div className="flex flex-col gap-5">
              <div className="text-center">
                <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--color-foreground)" }}>
                  Choose an agent
                </h2>
                <p className="text-xs" style={{ color: "var(--oc-text-muted)" }}>
                  It will handle all messages from this WhatsApp account.
                </p>
              </div>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
                style={{
                  background: "var(--oc-bg3)",
                  borderColor: "var(--oc-border)",
                  color: "var(--color-foreground)",
                }}
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id} &middot; {a.model ?? "---"}
                  </option>
                ))}
              </select>
              <Button className="w-full" onClick={() => setStep(2)} disabled={!selectedAgent}>
                <ChevronRight className="h-3.5 w-3.5" />
                Continue
              </Button>
            </div>
          )}

          {/* Step 2: QR Code */}
          {step === 2 && (
            <div className="flex flex-col items-center gap-4">
              <div className="text-center">
                <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--color-foreground)" }}>
                  Scan this QR code
                </h2>
                <p className="text-xs" style={{ color: "var(--oc-text-muted)" }}>
                  Open WhatsApp on your phone &rarr; Settings &rarr; Linked Devices &rarr; Link a Device
                </p>
              </div>
              <div
                className="rounded-md p-3.5"
                style={{
                  background: "#fff",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                {qrData ? (
                  <QRCodeSVG value={qrData} size={192} />
                ) : (
                  <div
                    className="flex h-[192px] w-[192px] items-center justify-center text-xs"
                    style={{ color: "var(--oc-text-muted)" }}
                  >
                    Generating QR...
                  </div>
                )}
              </div>
              <div
                className="flex items-center gap-2 text-[11.5px]"
                style={{ color: "var(--oc-text-dim)", fontFamily: "var(--oc-mono)" }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: "var(--oc-yellow)",
                    animation: "pulse 1s infinite",
                  }}
                />
                {statusText}
              </div>
              <span
                className="text-[11px]"
                style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
              >
                agent: {selectedAgent} &middot; SSE connected
              </span>
            </div>
          )}

          {/* Step 3: Success */}
          {step === 3 && (
            <div className="flex flex-col items-center gap-5">
              <div
                className="flex h-[52px] w-[52px] items-center justify-center rounded-full"
                style={{
                  background: "rgba(74,222,128,0.15)",
                  border: "1px solid rgba(74,222,128,0.3)",
                  color: "var(--oc-green)",
                }}
              >
                <Check className="h-[22px] w-[22px]" />
              </div>
              <div className="text-center">
                <h2 className="mb-1 text-base font-semibold" style={{ color: "var(--color-foreground)" }}>
                  Connected
                </h2>
                <p className="text-xs" style={{ color: "var(--oc-text-muted)" }}>
                  Phone{" "}
                  <span style={{ fontFamily: "var(--oc-mono)", color: "var(--color-foreground)" }}>
                    {phone}
                  </span>{" "}
                  is now bound to{" "}
                  <span style={{ fontFamily: "var(--oc-mono)", color: "var(--oc-accent)" }}>
                    {selectedAgent}
                  </span>
                  .
                </p>
              </div>
              <Button onClick={goBack}>Done</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
