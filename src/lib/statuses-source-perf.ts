/** Performance logs for order statuses manager — STATUSES_PERF=1 (default in dev) */

export type StatusesPerfScope =
  | "statuses.total"
  | "statuses.session"
  | "statuses.auth"
  | "statuses.ensure"
  | "statuses.query"
  | "statuses.count"
  | "statuses.map"
  | "statuses.serialize"
  | "statuses.render";

export function statusesPerfEnabled(): boolean {
  const flag = process.env.STATUSES_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.DEBUG_PERF_LOGS === "1" || process.env.DEBUG_PERF_LOGS === "true" || process.env.NODE_ENV === "development";
}

const timers = new Set<string>();
const marks = new Map<string, number>();

export function statusesPerfMark(scope: StatusesPerfScope): void {
  if (!statusesPerfEnabled()) return;
  marks.set(scope, performance.now());
}

export function statusesPerfMeasure(scope: StatusesPerfScope, startScope?: StatusesPerfScope): number {
  if (!statusesPerfEnabled()) return 0;
  const start = marks.get(startScope ?? scope) ?? performance.now();
  const ms = Math.round(performance.now() - start);
  console.log(`[statuses] ${scope}: ${ms}ms`);
  return ms;
}

export function statusesPerfStart(scope: StatusesPerfScope): void {
  if (!statusesPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  marks.set(scope, performance.now());
  console.time(scope);
}

export function statusesPerfEnd(scope: StatusesPerfScope): void {
  if (!statusesPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  const start = marks.get(scope);
  if (start != null) {
    console.log(`[statuses] ${scope}: ${Math.round(performance.now() - start)}ms`);
  }
  console.timeEnd(scope);
  marks.delete(scope);
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
