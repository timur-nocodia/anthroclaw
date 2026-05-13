"use client";

import { useParams } from "next/navigation";
import { BuildroomOverview } from "@/components/buildroom/BuildroomOverview";

export default function BuildroomPage() {
  const params = useParams();
  const serverId = (params?.serverId as string) || "local";
  return <BuildroomOverview serverId={serverId} />;
}
