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
        // Redirect placeholder — Phase 5 ships /mcp/done. For now we just
        // surface the success state inline and home the user.
        setTimeout(() => router.replace('/'), 1500);
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
      <main className="min-h-screen flex items-center justify-center">
        <div className="max-w-md w-full p-6 border rounded-xl text-center">
          <h1 className="text-lg font-medium mb-2">Connected</h1>
          <p className="text-sm text-gray-600">You can close this window.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <form
        className="max-w-md w-full space-y-4 p-6 border rounded-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className="text-lg font-medium">Paste your API key</h1>
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="w-full border rounded-md p-2"
          placeholder="sk_live_..."
          aria-label="API key"
        />
        <label className="text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={show}
            onChange={() => setShow((s) => !s)}
          />
          Show
        </label>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !key}
          className="bg-black text-white px-4 py-2 rounded-md disabled:opacity-50"
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </main>
  );
}
