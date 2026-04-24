import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Toaster } from "@/components/ui/sonner";

interface Props {
  children: ReactNode;
}

export default async function DashboardLayout({ children }: Props) {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) redirect("/login");

  try {
    await verifySessionToken(token);
  } catch {
    redirect("/login");
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      <Toaster />
    </div>
  );
}
