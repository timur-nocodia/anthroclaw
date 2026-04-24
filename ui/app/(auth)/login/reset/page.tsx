"use client";

import { useState, type FormEvent, type ReactNode, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Password Reset Page — /login/reset?token=xxx                       */
/* ------------------------------------------------------------------ */

const MIN_PASSWORD_LENGTH = 8;

function ResetForm(): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleReset(e: FormEvent) {
    e.preventDefault();

    if (!token) {
      setError("Missing or invalid reset token.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => router.push("/login"), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.error === "invalid_token") {
          setError("Reset token is invalid or expired.");
        } else if (data.error === "password_too_short") {
          setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        } else {
          setError("Something went wrong. Please try again.");
        }
      }
    } catch {
      setError("Network error. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
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

      <div className="mb-1 text-lg font-semibold text-foreground">
        Set new password
      </div>
      <div className="mb-5 text-xs" style={{ color: "var(--oc-text-muted)" }}>
        Choose a new password for your account.
      </div>

      {success ? (
        <div
          className="text-sm leading-relaxed"
          style={{ color: "var(--oc-green)", fontFamily: "var(--oc-mono)" }}
        >
          Password updated. Redirecting to login...
        </div>
      ) : (
        <>
          <form onSubmit={handleReset} className="flex flex-col gap-3">
            <div>
              <Label
                htmlFor="new-password"
                className="mb-1.5 block text-[11px] uppercase tracking-wider"
                style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
              >
                New password
              </Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Min 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 border-border text-sm text-foreground placeholder:text-muted-foreground"
                style={{
                  background: "var(--oc-bg3)",
                  borderColor: "var(--oc-border)",
                }}
              />
            </div>

            <div>
              <Label
                htmlFor="confirm-password"
                className="mb-1.5 block text-[11px] uppercase tracking-wider"
                style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
              >
                Confirm password
              </Label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="Repeat password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
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
              {loading ? "Resetting\u2026" : "Reset password"}
            </Button>
          </form>

          {/* ---- Footer ---- */}
          <div
            className="mt-4 flex justify-start border-t pt-3.5"
            style={{ borderColor: "var(--oc-border)" }}
          >
            <a
              href="/login"
              className="text-[11px] no-underline"
              style={{ color: "var(--oc-accent)", fontFamily: "var(--oc-mono)" }}
            >
              Back to sign in
            </a>
          </div>
        </>
      )}
    </Card>
  );
}

export default function ResetPasswordPage(): ReactNode {
  return (
    <div
      className="flex min-h-screen w-full items-center justify-center"
      style={{
        background: "var(--oc-bg0)",
        backgroundImage:
          "radial-gradient(ellipse at 30% 20%, rgba(124,156,255,0.08), transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(192,132,252,0.06), transparent 60%)",
      }}
    >
      <Suspense
        fallback={
          <div className="text-sm" style={{ color: "var(--oc-text-muted)" }}>
            Loading...
          </div>
        }
      >
        <ResetForm />
      </Suspense>
    </div>
  );
}
