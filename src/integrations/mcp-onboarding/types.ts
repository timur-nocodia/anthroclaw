export interface DiscoveredOAuth {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
  issuer: string;
  resource: string;
}

export type ProbeResult =
  | { authMode: 'none'; server: { name?: string; version?: string } }
  | {
      authMode: 'oauth';
      server: { name?: string; version?: string };
      oauth: DiscoveredOAuth;
    }
  | {
      authMode: 'apikey';
      server: { name?: string; version?: string };
      hint?: string;
    }
  | { authMode: 'manual'; reason: string };

export interface Requester {
  kind: 'admin' | 'agent';
  userId?: string;
  agentId: string;
  agentSessionKey?: string;
  chatType?: 'private' | 'group' | 'supergroup' | 'channel';
}
