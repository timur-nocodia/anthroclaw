import { redirect } from "next/navigation";

export default async function ChatRedirect({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  redirect(`/fleet/local/chat/${agentId}`);
}
