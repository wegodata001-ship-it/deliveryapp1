import type { Metadata } from "next";
import { AdminShellLayout } from "@/components/admin/AdminShellLayout";
import { getAdminRouteMode } from "@/lib/admin-route-mode";
import "./admin.css";
import "@/styles/wego-order-capture-fluid.css";
import "@/styles/wego-pro-responsive.css";
import "@/styles/wego-status-tags.css";
import "@/styles/wego-admin-scroll-shell.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: "noindex, nofollow",
};

/** Root admin shell — route mode (light/full) is set in middleware for source-tables. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const mode = await getAdminRouteMode();
  return <AdminShellLayout mode={mode}>{children}</AdminShellLayout>;
}
