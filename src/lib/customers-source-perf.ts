/** Performance logs for customers source table — CUSTOMERS_PERF=1 */

export type CustomersPerfScope =
  | "customers.load"
  | "customers.filters"
  | "customers.query"
  | "customers.count"
  | "customers.pagination"
  | "customers.response"
  | "customers.kpis"
  | "customers.preview";

export function customersPerfEnabled(): boolean {
  const flag = process.env.CUSTOMERS_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.DEBUG_PERF_LOGS === "1" || process.env.DEBUG_PERF_LOGS === "true" || process.env.NODE_ENV === "development";
}

const timers = new Set<string>();

export function customersPerfStart(scope: CustomersPerfScope): void {
  if (!customersPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function customersPerfEnd(scope: CustomersPerfScope): void {
  if (!customersPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}

export async function customersPerfRun<T>(scope: CustomersPerfScope, fn: () => Promise<T>): Promise<T> {
  customersPerfStart(scope);
  try {
    return await fn();
  } finally {
    customersPerfEnd(scope);
  }
}
