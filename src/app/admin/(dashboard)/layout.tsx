import { withPerfTimer } from "@/lib/perf-log";

/** Dashboard-only nested layout — stats load in page.tsx, not in parent shell. */
export default async function DashboardRouteLayout({ children }: { children: React.ReactNode }) {
  return withPerfTimer("admin.route.dashboard.layout", async () => children);
}
