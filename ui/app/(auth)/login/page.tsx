"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Login Page                                                         */
/* ------------------------------------------------------------------ */

export default function LoginPage(): ReactNode {
  const router = useRouter();

  /* ---- state ---- */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* ---- forgot-password inline form ---- */
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState("");
  const [forgotError, setForgotError] = useState("");

  /* ---- login submit ---- */
  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Both fields are required.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push("/fleet");
      } else if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.retryAfter
            ? `Too many attempts. Try again in ${Math.ceil(data.retryAfter / 60)} minutes.`
            : "Too many attempts. Please try again later.",
        );
      } else {
        setError("Invalid email or password.");
      }
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  /* ---- forgot-password submit ---- */
  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    if (!forgotEmail) {
      setForgotError("Email is required.");
      return;
    }
    setForgotError("");
    setForgotMsg("");
    setForgotLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      if (res.ok) {
        setForgotMsg(
          "If SMTP is configured, a reset link was sent. Otherwise, run `pnpm reset-password` in the terminal.",
        );
      } else {
        setForgotError("Something went wrong. Please try again.");
      }
    } catch {
      setForgotError("Network error. Check your connection.");
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen w-full items-center justify-center"
      style={{
        background: "var(--oc-bg0)",
        backgroundImage:
          "radial-gradient(ellipse at 30% 20%, rgba(124,156,255,0.08), transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(192,132,252,0.06), transparent 60%)",
      }}
    >
      <Card
        className="w-full max-w-[380px] border-border p-8"
        style={{
          background: "var(--oc-bg1)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          borderRadius: 10,
        }}
      >
        {/* ---- Branding ---- */}
        <div className="mb-6 flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center"
            style={{
              borderRadius: 7,
              background: "linear-gradient(135deg, var(--oc-accent), var(--oc-purple))",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0b0d12"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 19l4-12 3 9 3-6 4 9" />
            </svg>
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-foreground">
              AnthroClaw
            </div>
            <div
              className="text-[11px]"
              style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
            >
              control plane · v0.11.2
            </div>
          </div>
        </div>

        {/* ---- Sign-in / Forgot toggle ---- */}
        {!showForgot ? (
          <>
            <div className="mb-1 text-lg font-semibold text-foreground">Sign in</div>
            <div
              className="mb-5 text-xs"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Access your gateway.
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <div>
                <Label
                  htmlFor="email"
                  className="mb-1.5 block text-[11px] uppercase tracking-wider"
                  style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
                >
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.dev"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-8 border-border text-sm text-foreground placeholder:text-muted-foreground"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                  }}
                />
              </div>

              <div>
                <Label
                  htmlFor="password"
                  className="mb-1.5 block text-[11px] uppercase tracking-wider"
                  style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
                >
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-8 border-border text-sm text-foreground placeholder:text-muted-foreground"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                  }}
                />
              </div>

              {error && (
                <div
                  className="text-[11px]"
                  style={{ color: "var(--oc-red)", fontFamily: "var(--oc-mono)" }}
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="mt-1 h-8 w-full cursor-pointer text-xs font-semibold"
                style={{
                  background: "var(--oc-accent)",
                  color: "var(--oc-bg0)",
                  border: "1px solid var(--oc-accent)",
                }}
              >
                {loading ? "Signing in\u2026" : "Sign in"}
              </Button>
            </form>

            {/* ---- Footer links ---- */}
            <div
              className="mt-4 flex justify-end border-t pt-3.5"
              style={{ borderColor: "var(--oc-border)" }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowForgot(true);
                  setForgotEmail(email);
                }}
                className="cursor-pointer border-none bg-transparent text-[11px]"
                style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
              >
                Reset password
              </button>
            </div>
          </>
        ) : (
          /* ---- Forgot password form ---- */
          <>
            <div className="mb-1 text-lg font-semibold text-foreground">
              Reset password
            </div>
            <div
              className="mb-5 text-xs"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Enter your email to receive a reset link.
            </div>

            <form onSubmit={handleForgot} className="flex flex-col gap-3">
              <div>
                <Label
                  htmlFor="forgot-email"
                  className="mb-1.5 block text-[11px] uppercase tracking-wider"
                  style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
                >
                  Email
                </Label>
                <Input
                  id="forgot-email"
                  type="email"
                  placeholder="you@company.dev"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="h-8 border-border text-sm text-foreground placeholder:text-muted-foreground"
                  style={{
                    background: "var(--oc-bg3)",
                    borderColor: "var(--oc-border)",
                  }}
                />
              </div>

              {forgotError && (
                <div
                  className="text-[11px]"
                  style={{ color: "var(--oc-red)", fontFamily: "var(--oc-mono)" }}
                >
                  {forgotError}
                </div>
              )}

              {forgotMsg && (
                <div
                  className="text-[11px] leading-relaxed"
                  style={{ color: "var(--oc-green)", fontFamily: "var(--oc-mono)" }}
                >
                  {forgotMsg}
                </div>
              )}

              <Button
                type="submit"
                disabled={forgotLoading}
                className="mt-1 h-8 w-full cursor-pointer text-xs font-semibold"
                style={{
                  background: "var(--oc-accent)",
                  color: "var(--oc-bg0)",
                  border: "1px solid var(--oc-accent)",
                }}
              >
                {forgotLoading ? "Sending\u2026" : "Send reset link"}
              </Button>
            </form>

            <div
              className="mt-4 flex justify-start border-t pt-3.5"
              style={{ borderColor: "var(--oc-border)" }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowForgot(false);
                  setForgotMsg("");
                  setForgotError("");
                }}
                className="cursor-pointer border-none bg-transparent text-[11px]"
                style={{ color: "var(--oc-accent)", fontFamily: "var(--oc-mono)" }}
              >
                Back to sign in
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
