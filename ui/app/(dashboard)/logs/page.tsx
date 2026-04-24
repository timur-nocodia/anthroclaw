import { redirect } from "next/navigation";

export default function LogsRedirect() {
  redirect("/fleet/local/logs");
}
