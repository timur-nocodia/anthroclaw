/**
 * Wizard component for adding an external MCP server to an agent.
 *
 * Phase 3 implements steps 1 (URL probe → start) and 3 (tool selection →
 * finalize) plus the apikey branch of step 2. The OAuth branch of step 2
 * navigates the operator to `/api/mcp/oauth/start/<pendingId>` and is
 * filled in by Phase 4. Phase 7 wires this component into the agent page.
 */
'use client';

import { useState } from 'react';

export interface AddMcpWizardProps {
  agentId: string;
  onClose: () => void;
  onSaved: () => void;
}

type Step = 'url' | 'auth' | 'tools';
type AuthMode = 'oauth' | 'apikey';

interface OAuthMeta {
  authorizationEndpoint?: string;
  scopesSupported?: string[];
}

/**
 * Map of known reject reasons from `/api/mcp/connect/start` to operator-
 * friendly copy. Unknown reasons fall back to a generic "Couldn't connect"
 * message that still surfaces the internal code for support diagnosis.
 */
const FRIENDLY_REASONS: Record<string, string> = {
  no_auth_servers_not_yet_supported:
    "This server doesn't require authentication. Open MCP servers aren't supported yet — paste a server URL that requires OAuth or an API key.",
  dcr_required_but_not_supported:
    'This server requires dynamic client registration, but no static client_id was configured for this instance. Configure OAUTH_STATIC_CLIENT_ID in your environment to use such servers.',
  mcp_onboarding_requires_dm:
    'MCP onboarding through chat requires a private (direct) conversation. (This UI was reached from a chat link — try the admin panel.)',
};

function friendlyRejectMessage(reason: string | undefined): string {
  const r = reason ?? 'unknown';
  return FRIENDLY_REASONS[r] ?? `Couldn't connect — ${r}`;
}

export function AddMcpWizard({ agentId, onClose, onSaved }: AddMcpWizardProps) {
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [serverName, setServerName] = useState<string | null>(null);
  const [oauthMeta, setOauthMeta] = useState<OAuthMeta | null>(null);
  const [tools, setTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function next() {
    setError(null);
    setBusy(true);
    try {
      if (step === 'url') {
        const probeRes = await fetch('/api/mcp/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const probe = await probeRes.json();
        if (probe.authMode === 'manual') {
          setError(`Server unreachable or unsupported (${probe.reason ?? 'unknown'})`);
          return;
        }
        const startRes = await fetch('/api/mcp/connect/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, agentId }),
        });
        const start = await startRes.json();
        if (start.status === 'rejected') {
          setError(friendlyRejectMessage(start.reason));
          return;
        }
        setPendingId(start.pendingId ?? null);
        setAuthMode(probe.authMode);
        setServerName(probe.server?.name ?? start.serverName ?? null);
        if (probe.authMode === 'oauth' && probe.oauth) {
          setOauthMeta({
            authorizationEndpoint: probe.oauth.authorizationEndpoint,
            scopesSupported: probe.oauth.scopesSupported,
          });
        } else {
          setOauthMeta(null);
        }
        setStep('auth');
        return;
      }

      if (step === 'auth' && authMode === 'apikey') {
        if (!pendingId) {
          setError('Lost pending connection — please restart');
          return;
        }
        const res = await fetch('/api/mcp/connect/apikey', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingId, token: apiKey }),
        });
        const body = await res.json();
        if (body.status !== 'connected') {
          setError('Invalid key');
          return;
        }
        const discovered = (body.tools ?? []) as Array<{
          name: string;
          description?: string;
        }>;
        setTools(discovered);
        setAllowed(new Set(discovered.map((t) => t.name)));
        setStep('tools');
        return;
      }

      if (step === 'auth' && authMode === 'oauth') {
        // Phase 4 fills the actual OAuth dance; here we navigate so the
        // operator picks up at the authorize endpoint.
        if (typeof window !== 'undefined' && pendingId) {
          window.location.href = `/api/mcp/oauth/start/${pendingId}`;
        }
        return;
      }

      if (step === 'tools') {
        if (!pendingId) {
          setError('Lost pending connection — please restart');
          return;
        }
        await fetch('/api/mcp/connect/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingId, allowed_tools: [...allowed] }),
        });
        onSaved();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  const canContinue
    = (step === 'url' && url.length > 0)
      || (step === 'auth' && authMode === 'apikey' && apiKey.length > 0)
      || (step === 'auth' && authMode === 'oauth')
      || step === 'tools';

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Add MCP server"
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
    >
      <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4">
        <header className="flex justify-between">
          <h2 className="font-medium">Add MCP server</h2>
          <button onClick={onClose} aria-label="Close">
            X
          </button>
        </header>

        {step === 'url' && (
          <div className="space-y-2">
            <label className="text-sm">Server URL</label>
            <input
              className="w-full border rounded-md p-2"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.x.io/mcp"
              aria-label="Server URL"
            />
          </div>
        )}

        {step === 'auth' && authMode === 'apikey' && (
          <div className="space-y-2">
            <p className="text-sm">This server needs a bearer token.</p>
            <input
              className="w-full border rounded-md p-2"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              aria-label="API key"
            />
          </div>
        )}

        {step === 'auth' && authMode === 'oauth' && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              Authorize with {serverName ?? 'this server'}
            </h3>
            <p className="text-sm">
              You&apos;ll be redirected to{' '}
              <code>
                {oauthMeta?.authorizationEndpoint
                  ? (() => {
                      try {
                        return new URL(oauthMeta.authorizationEndpoint).hostname;
                      } catch {
                        return 'the provider';
                      }
                    })()
                  : 'the provider'}
              </code>{' '}
              to authorize. Token will be stored encrypted in this AnthroClaw
              instance.
            </p>
            <p className="text-xs text-gray-600">
              Scopes:{' '}
              {oauthMeta?.scopesSupported?.length
                ? oauthMeta.scopesSupported.join(', ')
                : 'none requested'}
            </p>
          </div>
        )}

        {step === 'tools' && (
          <div className="space-y-2">
            <p className="text-sm">Choose which tools the agent can use:</p>
            <ul className="space-y-1 max-h-64 overflow-auto">
              {tools.map((t) => (
                <li key={t.name}>
                  <label className="text-sm flex gap-2">
                    <input
                      type="checkbox"
                      checked={allowed.has(t.name)}
                      onChange={() => {
                        const n = new Set(allowed);
                        if (n.has(t.name)) n.delete(t.name);
                        else n.add(t.name);
                        setAllowed(n);
                      }}
                    />
                    {t.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <footer className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md border">
            Cancel
          </button>
          <button
            onClick={() => void next()}
            disabled={busy || !canContinue}
            className="px-3 py-1.5 rounded-md bg-black text-white disabled:opacity-50"
          >
            {step === 'tools' ? 'Save & Connect' : 'Continue →'}
          </button>
        </footer>
      </div>
    </div>
  );
}
