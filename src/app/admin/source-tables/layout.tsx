import { withPerfTimer } from "@/lib/perf-log";

/** Lightweight nested layout for all source-table routes — no dashboard or layout-heavy fetches. */
export default async function SourceTablesRouteLayout({ children }: { children: React.ReactNode }) {
  return withPerfTimer("admin.route.source-tables.layout", async () => children);
}
