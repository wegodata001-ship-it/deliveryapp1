/** Performance logs for GET /api/customers/search-fast — set SEARCH_PERF=1 on Vercel. */

export function searchPerfEnabled(): boolean {
  const flag = process.env.SEARCH_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.NODE_ENV === "development";
}

const timers = new Set<string>();

export function searchPerfTimeStart(scope: "searchFast.total" | "searchFast.auth" | "searchFast.db" | "searchFast.response"): void {
  if (!searchPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function searchPerfTimeEnd(scope: "searchFast.total" | "searchFast.auth" | "searchFast.db" | "searchFast.response"): void {
  if (!searchPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}

export function searchPerfLog(extra: Record<string, unknown>): void {
  if (!searchPerfEnabled()) return;
  const uptime =
    typeof process !== "undefined" && typeof process.uptime === "function"
      ? Number(process.uptime().toFixed(3))
      : undefined;
  console.log("[searchFast]", {
    ts: new Date().toISOString(),
    uptimeSec: uptime,
    coldStartLikely: uptime !== undefined && uptime < 2,
    vercel: !!process.env.VERCEL,
    ...extra,
  });
}
