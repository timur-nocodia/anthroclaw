"use client";

/**
 * HandoffTab — composes the four Handoff sections:
 *
 *   ┌── Auto-pause on human takeover ──┐  (HumanTakeoverCard)
 *   ├── Notifications ─────────────────┤  (NotificationsCard)
 *   ├── Active pauses ─────────────────┤  (ActivePausesTable)
 *   └── Activity log ──────────────────┘  (ActivityLogPanel)
 */

import { HumanTakeoverCard, type HumanTakeoverConfig } from "./HumanTakeoverCard";
import { NotificationsCard, type NotificationsConfig } from "./NotificationsCard";
import { ActivePausesTable } from "./ActivePausesTable";
import { ActivityLogPanel } from "./ActivityLogPanel";

/**
 * Loose shape — accepts the AgentConfig from page.tsx whose `notifications`
 * field is typed with `event: string` (the parent doesn't narrow to the
 * NotificationsConfig event union). NotificationsCard re-narrows internally.
 */
interface HandoffAgent {
  human_takeover?: Partial<HumanTakeoverConfig>;
  notifications?: {
    enabled?: boolean;
    routes?: NotificationsConfig["routes"];
    subscriptions?: Array<{
      event: string;
      route: string;
      schedule?: string;
      throttle?: string;
    }>;
  };
}

export interface HandoffTabProps {
  serverId: string;
  agentId: string;
  agent: HandoffAgent;
}

export function HandoffTab({ agentId, agent }: HandoffTabProps) {
  return (
    <div className="space-y-4 p-5">
      <HumanTakeoverCard agentId={agentId} initialConfig={agent.human_takeover} />
      <NotificationsCard
        agentId={agentId}
        initialConfig={agent.notifications as Partial<NotificationsConfig> | undefined}
      />
      <ActivePausesTable agentId={agentId} />
      <ActivityLogPanel agentId={agentId} />
    </div>
  );
}
