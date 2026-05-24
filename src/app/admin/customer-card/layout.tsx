import { withPerfTimer } from "@/lib/perf-log";

export default async function CustomerCardRouteLayout({ children }: { children: React.ReactNode }) {
  return withPerfTimer("admin.route.customer-card.layout", async () => children);
}
