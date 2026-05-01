"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, FlaskConical, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export interface BindingTestRoute {
  channel: "telegram" | "whatsapp";
  account: string;
  scope: "dm" | "group" | "any";
  peers?: string[] | null;
  topics?: string[] | null;
  mention_only?: boolean;
  mentionOnly?: boolean;
}

export interface BindingTestPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  route: BindingTestRoute;
}

interface Blocker {
  stage: "route" | "mention" | "access";
  reason: string;
}

interface RouteTestResponse {
  matched: boolean;
  agent_id: string | null;
  session_key: string | null;
  blockers: Blocker[];
}

type ResultState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: RouteTestResponse }
  | { kind: "error"; message: string };

function deriveChatType(scope: BindingTestRoute["scope"]): "dm" | "group" {
  if (scope === "dm") return "dm";
  return "group";
}

function deriveMentionDefault(route: BindingTestRoute): boolean {
  if (typeof route.mention_only === "boolean") return route.mention_only;
  if (typeof route.mentionOnly === "boolean") return route.mentionOnly;
  return false;
}

export function BindingTestPanel({
  open,
  onOpenChange,
  agentId,
  route,
}: BindingTestPanelProps) {
  const initialPeer = route.peers?.[0] ?? "";
  const initialThread = route.topics?.[0] ?? "";
  const initialMention = deriveMentionDefault(route);

  const [peerId, setPeerId] = useState(initialPeer);
  const [threadId, setThreadId] = useState(initialThread);
  const [senderId, setSenderId] = useState("");
  const [text, setText] = useState("");
  const [mentioned, setMentioned] = useState(initialMention);
  const [result, setResult] = useState<ResultState>({ kind: "idle" });

  // Reset form whenever the dialog opens with a (potentially) different route.
  useEffect(() => {
    if (!open) return;
    setPeerId(route.peers?.[0] ?? "");
    setThreadId(route.topics?.[0] ?? "");
    setSenderId("");
    setText("");
    setMentioned(deriveMentionDefault(route));
    setResult({ kind: "idle" });
  }, [open, route]);

  const chatType = deriveChatType(route.scope);
  const channelLabel = route.channel === "telegram" ? "Telegram" : "WhatsApp";

  const canSubmit =
    senderId.trim().length > 0 &&
    peerId.trim().length > 0 &&
    result.kind !== "loading";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setResult({ kind: "loading" });
    const body = {
      channel: route.channel,
      account_id: route.account,
      chat_type: chatType,
      peer_id: peerId.trim(),
      ...(threadId.trim() ? { thread_id: threadId.trim() } : {}),
      sender_id: senderId.trim(),
      ...(text.length > 0 ? { text } : {}),
      mentioned_bot: mentioned,
    };
    try {
      const res = await fetch(`/api/agents/${agentId}/route-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        setResult({
          kind: "error",
          message: errText || `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as RouteTestResponse;
      setResult({ kind: "success", data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({ kind: "error", message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="binding-test-panel"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical
              className="h-3.5 w-3.5"
              style={{ color: "var(--oc-accent)" }}
            />
            Test binding
          </DialogTitle>
          <DialogDescription>
            Simulate an inbound message and check whether this binding would
            match. No message is sent.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="grid grid-cols-2 gap-2">
            <ReadOnlyField
              label="Channel"
              value={channelLabel}
              testId="binding-test-channel"
            />
            <ReadOnlyField
              label="Account"
              value={route.account}
              testId="binding-test-account"
            />
            <ReadOnlyField
              label="Chat type"
              value={chatType}
              testId="binding-test-chat-type"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="binding-test-peer-id" className="text-[12px]">
              Peer ID
            </Label>
            <Input
              id="binding-test-peer-id"
              data-testid="binding-test-peer-id"
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
              placeholder={
                route.channel === "telegram"
                  ? "-1003729315809"
                  : "1234@s.whatsapp.net"
              }
            />
          </div>

          {chatType === "group" && (
            <div className="flex flex-col gap-1">
              <Label
                htmlFor="binding-test-thread-id"
                className="text-[12px]"
              >
                Thread ID (topic)
              </Label>
              <Input
                id="binding-test-thread-id"
                data-testid="binding-test-thread-id"
                value={threadId}
                onChange={(e) => setThreadId(e.target.value)}
                placeholder="3"
              />
              <p
                className="text-[11px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                Optional. Leave empty for non-forum groups.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="binding-test-sender-id" className="text-[12px]">
              Sender ID <span style={{ color: "var(--oc-danger, #b91c1c)" }}>*</span>
            </Label>
            <Input
              id="binding-test-sender-id"
              data-testid="binding-test-sender-id"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              placeholder="123456789"
              required
            />
            <p
              className="text-[11px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Numeric Telegram user ID. Find your own with @userinfobot.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="binding-test-text" className="text-[12px]">
              Message text
            </Label>
            <Textarea
              id="binding-test-text"
              data-testid="binding-test-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="@your_bot some message"
              rows={2}
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              data-testid="binding-test-mention"
              checked={mentioned}
              onChange={(e) => setMentioned(e.target.checked)}
              className="mt-0.5"
            />
            <span
              className="text-[12px]"
              style={{ color: "var(--color-foreground)" }}
            >
              This message @-mentions the bot
            </span>
          </label>

          <ResultDisplay result={result} agentId={agentId} />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            data-testid="binding-test-close"
          >
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="binding-test-run"
          >
            {result.kind === "loading" ? "Running…" : "Run match"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReadOnlyField({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[11px] uppercase tracking-wide"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {label}
      </span>
      <span
        className="text-[12.5px] font-medium"
        style={{ color: "var(--color-foreground)" }}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}

function ResultDisplay({
  result,
  agentId,
}: {
  result: ResultState;
  agentId: string;
}) {
  if (result.kind === "idle") return null;
  if (result.kind === "loading") {
    return (
      <p
        className="text-[12px]"
        style={{ color: "var(--oc-text-muted)" }}
        data-testid="binding-test-result-loading"
      >
        Running…
      </p>
    );
  }
  if (result.kind === "error") {
    return (
      <div
        className="rounded-md border p-2 text-[12px]"
        style={{
          background: "var(--oc-bg0)",
          borderColor: "var(--oc-danger, #b91c1c)",
          color: "var(--oc-danger, #b91c1c)",
        }}
        data-testid="binding-test-result-error"
      >
        Error: {result.message}
      </div>
    );
  }

  const data = result.data;

  if (data.matched) {
    return (
      <div
        className="rounded-md border p-2 flex flex-col gap-1"
        style={{
          background: "var(--oc-bg0)",
          borderColor: "var(--oc-success, #16a34a)",
          color: "var(--color-foreground)",
        }}
        data-testid="binding-test-result-matched"
      >
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <Check
            className="h-3.5 w-3.5"
            style={{ color: "var(--oc-success, #16a34a)" }}
          />
          <span>
            Routed to <strong>{data.agent_id}</strong>
          </span>
        </div>
        {data.session_key && (
          <code
            className="text-[11.5px] rounded px-1 py-0.5"
            style={{
              background: "var(--oc-bg1, var(--oc-bg0))",
              color: "var(--oc-text-muted)",
              fontFamily: "var(--oc-mono)",
            }}
            data-testid="binding-test-result-session-key"
          >
            {data.session_key}
          </code>
        )}
      </div>
    );
  }

  // Not matched. If a different agent owns the route, show as warning;
  // otherwise show as the standard not-matched red callout.
  const ownedByOther =
    data.agent_id !== null && data.agent_id !== agentId;

  if (ownedByOther) {
    return (
      <div
        className="rounded-md border p-2 flex flex-col gap-1"
        style={{
          background: "var(--oc-bg0)",
          borderColor: "var(--oc-warning, #d97706)",
          color: "var(--color-foreground)",
        }}
        data-testid="binding-test-result-other-agent"
      >
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <AlertTriangle
            className="h-3.5 w-3.5"
            style={{ color: "var(--oc-warning, #d97706)" }}
          />
          <span>
            Matched a different agent: <strong>{data.agent_id}</strong>
          </span>
        </div>
        {data.blockers.length > 0 && (
          <ul className="flex flex-col gap-0.5 pl-4 list-disc">
            {data.blockers.map((b, i) => (
              <li
                key={i}
                className="text-[11.5px]"
                style={{ color: "var(--oc-text-muted)" }}
                data-testid="binding-test-blocker"
              >
                <span className="uppercase tracking-wide">{b.stage}</span>:{" "}
                {b.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-md border p-2 flex flex-col gap-1"
      style={{
        background: "var(--oc-bg0)",
        borderColor: "var(--oc-danger, #b91c1c)",
        color: "var(--color-foreground)",
      }}
      data-testid="binding-test-result-not-matched"
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        <X
          className="h-3.5 w-3.5"
          style={{ color: "var(--oc-danger, #b91c1c)" }}
        />
        <span>Not matched</span>
      </div>
      {data.blockers.length === 0 ? (
        <p
          className="text-[11.5px]"
          style={{ color: "var(--oc-text-muted)" }}
        >
          No specific blockers reported.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5 pl-4 list-disc">
          {data.blockers.map((b, i) => (
            <li
              key={i}
              className="text-[11.5px]"
              style={{ color: "var(--oc-text-muted)" }}
              data-testid="binding-test-blocker"
            >
              <span className="uppercase tracking-wide">{b.stage}</span>:{" "}
              {b.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
