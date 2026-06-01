/** Performance logs for order statuses manager — STATUSES_PERF=1 */

export type StatusesPerfScope =
  | "statuses.load"
  | "statuses.filters"
  | "statuses.query"
  | "statuses.count"
  | "statuses.response";

export function statusesPerfEnabled(): boolean {
  const flag = process.env.STATUSES_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.DEBUG_PERF_LOGS === "1" || process.env.DEBUG_PERF_LOGS === "true" || process.env.NODE_ENV === "development";
}

const timers = new Set<string>();

export function statusesPerfStart(scope: StatusesPerfScope): void {
  if (!statusesPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function statusesPerfEnd(scope: StatusesPerfScope): void {
  if (!statusesPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}

export async function statusesPerfRun<T>(scope: StatusesPerfScope, fn: () => Promise<T>): Promise<T> {
  statusesPerfStart(scope);
  try {
    return await fn();
  } finally {
    statusesPerfEnd(scope);
  }
}

export function statusesPerfLog(message: string, data?: Record<string, unknown>): void {
  if (!statusesPerfEnabled()) return;
  console.log(`[statuses] ${message}`, data ?? "");
}
