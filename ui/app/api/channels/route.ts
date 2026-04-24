import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { getGateway } from '@/lib/gateway';

export async function GET() {
  return withAuth(async () => {
    const gw = await getGateway();
    const status = gw.getStatus();

    const telegram = status.channels.telegram.map((acct) => ({
      ...acct,
      routes: [] as Record<string, unknown>[],
    }));

    const whatsapp = status.channels.whatsapp.map((acct) => ({
      ...acct,
      routes: [] as Record<string, unknown>[],
    }));

    // Collect routes from agents
    for (const agent of gw.getAgentList()) {
      for (const route of agent.config.routes) {
        const routeEntry = {
          agentId: agent.id,
          channel: route.channel,
          scope: route.scope,
          account: route.account,
          peers: route.peers,
          topics: route.topics,
          mention_only: route.mention_only,
        };

        const channelList =
          route.channel === 'telegram' ? telegram :
          route.channel === 'whatsapp' ? whatsapp :
          null;
        if (!channelList) continue;

        const target = route.account
          ? channelList.find((a) => a.accountId === route.account)
          : channelList[0];
        if (target) target.routes.push(routeEntry);
      }
    }

    return NextResponse.json({ telegram, whatsapp });
  });
}
