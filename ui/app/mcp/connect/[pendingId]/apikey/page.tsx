/**
 * One-shot apikey paste page reached from a chat-delivered link
 * (`/mcp/connect/<pendingId>/apikey`). The route is intentionally
 * unauthenticated — the unguessable `pendingId` and the 10-minute TTL on the
 * pending row are the security boundary so a non-admin user who received
 * the link can paste their key without needing to log in.
 */
'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ApiKeyPage() {
  const params = useParams<{ pendingId: string }>();
  const pendingId = params?.pendingId;
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit() {
    if (!pendingId) {
      setError('Missing connection id');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/mcp/connect/apikey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingId, token: key }),
      });
      const body = await res.json();
      if (body.status === 'connected') {
        setDone(true);
        // TODO(Phase 5+): redirect to /mcp/done once we wire the chat-side
        // route to land there. For now just home the user after a beat.
        setTimeout(() => router.replace('/mcp/done'), 1200);
      } else {
        setError('Invalid key — try again');
      }
    } catch {
      setError('Network error — try again');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border bg-card p-6 text-center space-y-3">
          <CheckCircle2 className="size-10 mx-auto text-emerald-500" aria-hidden />
          <h1 className="text-lg font-medium">Connected</h1>
          <p className="text-sm text-muted-foreground">You can close this window.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <form
        className="max-w-md w-full space-y-4 rounded-xl border bg-card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1">
          <h1 className="text-lg font-medium">Paste your API key</h1>
          <p className="text-xs text-muted-foreground">
            Token will be stored encrypted in this AnthroClaw instance.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="apikey">API key</Label>
          <Input
            id="apikey"
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk_live_..."
            autoFocus
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border-input accent-primary"
            checked={show}
            onChange={() => setShow((s) => !s)}
          />
          Show key
        </label>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !key} className="w-full">
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
      </form>
    </main>
  );
}
