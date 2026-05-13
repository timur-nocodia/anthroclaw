/**
 * Wizard component for adding an external MCP server to an agent.
 *
 * Phase 3 implements steps 1 (URL probe → start) and 3 (tool selection →
 * finalize) plus the apikey branch of step 2. The OAuth branch of step 2
 * navigates the operator to `/api/mcp/oauth/start/<pendingId>` and is
 * filled in by Phase 4. Phase 7 wires this component into the agent page.
 */
'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface AddMcpWizardProps {
  agentId: string;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Resume an in-flight onboarding at the tools-selection step. Passed by
   * the agent page when the OAuth callback redirects back with
   * `?mcpWizard=tools&pendingId=…` — at that point the credential is
   * saved and `tools` have been discovered, but `finalize` hasn't run.
   * The wizard hydrates the tools from `GET /api/mcp/pending/<id>` and
   * skips straight to step 3.
   */
  resumePendingId?: string;
}

type Step = 'url' | 'auth' | 'tools';
type AuthMode = 'oauth' | 'apikey';

interface OAuthMeta {
  authorizationEndpoint?: string;
  scopesSupported?: string[];
}

const FRIENDLY_REASONS: Record<string, string> = {
  dcr_required_but_not_supported:
    'This server requires dynamic client registration, but no static client_id was configured for this instance. Configure OAUTH_STATIC_CLIENT_ID in your environment to use such servers.',
  mcp_onboarding_requires_dm:
    'MCP onboarding through chat requires a private (direct) conversation. (This UI was reached from a chat link — try the admin panel.)',
};

function friendlyRejectMessage(reason: string | undefined): string {
  const r = reason ?? 'unknown';
  return FRIENDLY_REASONS[r] ?? `Couldn't connect — ${r}`;
}

export function AddMcpWizard({ agentId, onClose, onSaved, resumePendingId }: AddMcpWizardProps) {
  const [step, setStep] = useState<Step>(resumePendingId ? 'tools' : 'url');
  const [url, setUrl] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(resumePendingId ?? null);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [serverName, setServerName] = useState<string | null>(null);
  const [oauthMeta, setOauthMeta] = useState<OAuthMeta | null>(null);
  const [tools, setTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Resume path: hydrate the tools list for the pending row whose OAuth
  // just completed. The credential is already saved at this point — only
  // `finalize` (run by clicking Save below) remains to be done.
  useEffect(() => {
    if (!resumePendingId) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/mcp/pending/${encodeURIComponent(resumePendingId)}`);
        if (!res.ok) {
          if (!cancelled) setError(`Couldn't resume onboarding — pending session not found.`);
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        if (body.status !== 'completed') {
          setError(`Onboarding ${body.status} — restart from the + Add server button.`);
          return;
        }
        const discovered = (body.tools ?? []) as Array<{ name: string; description?: string }>;
        setTools(discovered);
        setAllowed(new Set(discovered.map((t) => t.name)));
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [resumePendingId]);

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
        // Open server: facade probed, discovered tools, marked the pending
        // row completed in a single call. Skip the auth step entirely.
        if (start.status === 'connected') {
          const discovered = (start.tools ?? []) as Array<{
            name: string;
            description?: string;
          }>;
          setTools(discovered);
          setAllowed(new Set(discovered.map((t) => t.name)));
          setStep('tools');
          return;
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
        const res = await fetch('/api/mcp/connect/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pendingId, allowed_tools: [...allowed] }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          const friendly = body.error ? (FRIENDLY_REASONS[body.error] ?? `Couldn't save — ${body.error}`) : `Couldn't save (status ${res.status})`;
          setError(friendly);
          return;
        }
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

  const authHost = (() => {
    if (!oauthMeta?.authorizationEndpoint) return 'the provider';
    try {
      return new URL(oauthMeta.authorizationEndpoint).hostname;
    } catch {
      return 'the provider';
    }
  })();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
        </DialogHeader>

        {step === 'url' && (
          <div className="space-y-2">
            <Label htmlFor="mcp-url">Server URL</Label>
            <Input
              id="mcp-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.x.io/mcp"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Just paste the URL — we&apos;ll figure out the rest.
            </p>
          </div>
        )}

        {step === 'auth' && authMode === 'apikey' && (
          <div className="space-y-2">
            <Label htmlFor="mcp-apikey">API key</Label>
            <Input
              id="mcp-apikey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              This server needs a bearer token. It will be stored encrypted in this AnthroClaw instance.
            </p>
          </div>
        )}

        {step === 'auth' && authMode === 'oauth' && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">
              Authorize with {serverName ?? 'this server'}
            </h3>
            <p className="text-sm text-muted-foreground">
              You&apos;ll be redirected to{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{authHost}</code>{' '}
              to authorize. Token will be stored encrypted in this AnthroClaw instance.
            </p>
            <p className="text-xs text-muted-foreground">
              Scopes:{' '}
              {oauthMeta?.scopesSupported?.length
                ? oauthMeta.scopesSupported.join(', ')
                : 'provider-default'}
            </p>
          </div>
        )}

        {step === 'tools' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Choose which tools the agent can use:
            </p>
            <ul className="space-y-1 max-h-64 overflow-auto rounded-md border bg-muted/40 p-3">
              {tools.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  No tools discovered. Save anyway to keep the credential — you can refresh tools later.
                </li>
              )}
              {tools.map((t) => (
                <li key={t.name}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary"
                      checked={allowed.has(t.name)}
                      onChange={() => {
                        const n = new Set(allowed);
                        if (n.has(t.name)) n.delete(t.name);
                        else n.add(t.name);
                        setAllowed(n);
                      }}
                    />
                    <span className="font-mono">{t.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void next()} disabled={busy || !canContinue}>
            {busy ? 'Working…' : step === 'tools' ? 'Save & Connect' : 'Continue →'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
