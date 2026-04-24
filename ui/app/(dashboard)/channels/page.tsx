import { redirect } from "next/navigation";

export default function ChannelsRedirect() {
  redirect("/fleet/local/channels");
}
