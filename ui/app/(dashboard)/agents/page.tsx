import { redirect } from "next/navigation";

export default function AgentsRedirect() {
  redirect("/fleet/local/agents");
}
