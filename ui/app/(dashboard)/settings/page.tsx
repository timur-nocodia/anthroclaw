import { redirect } from "next/navigation";

export default function SettingsRedirect() {
  redirect("/fleet/local/settings");
}
