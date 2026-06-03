/** Performance logs for admin shell layout — LAYOUT_PERF=1 (default in dev) */

export type AdminLayoutPerfScope =
  | "layout.auth"
  | "layout.user"
  | "layout.counts"
  | "layout.kpi"
  | "layout.financial"
  | "layout.render"
  | "layout.total";

export function adminLayoutPerfEnabled(): boolean {
  const flag = process.env.LAYOUT_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.DEBUG_PERF_LOGS === "1" || process.env.DEBUG_PERF_LOGS === "true" || process.env.NODE_ENV === "development";
}

const timers = new Set<string>();

export function adminLayoutPerfStart(scope: AdminLayoutPerfScope): void {
  if (!adminLayoutPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function adminLayoutPerfEnd(scope: AdminLayoutPerfScope): void {
  if (!adminLayoutPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}

export async function adminLayoutPerfRun<T>(scope: AdminLayoutPerfScope, fn: () => Promise<T>): Promise<T> {
  adminLayoutPerfStart(scope);
  try {
    return await fn();
  } finally {
    adminLayoutPerfEnd(scope);
  }
}

export function adminLayoutPerfLog(message: string, data?: Record<string, unknown>): void {
  if (!adminLayoutPerfEnabled()) return;
  console.log(`[layout] ${message}`, data ?? "");
}
