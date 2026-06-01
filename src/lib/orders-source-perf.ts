/** Performance logs for orders source table — ORDERS_PERF=1 */

export type OrdersPerfScope =
  | "orders.load"
  | "orders.filters"
  | "orders.query"
  | "orders.count"
  | "orders.pagination"
  | "orders.response"
  | "orders.kpis"
  | "orders.preview";

export function ordersPerfEnabled(): boolean {
  const flag = process.env.ORDERS_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.DEBUG_PERF_LOGS === "1" || process.env.DEBUG_PERF_LOGS === "true" || process.env.NODE_ENV === "development";
}

const timers = new Set<string>();

export function ordersPerfStart(scope: OrdersPerfScope): void {
  if (!ordersPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function ordersPerfEnd(scope: OrdersPerfScope): void {
  if (!ordersPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}

export async function ordersPerfRun<T>(scope: OrdersPerfScope, fn: () => Promise<T>): Promise<T> {
  ordersPerfStart(scope);
  try {
    return await fn();
  } finally {
    ordersPerfEnd(scope);
  }
}
