/** Performance logs for order capture bootstrap APIs — BOOT_PERF=1 */

export type OrdersBootPerfScope =
  | "boot.total"
  | "boot.week"
  | "boot.nextOrderNumber"
  | "boot.exchangeRate"
  | "boot.locations";

const timers = new Set<string>();

export function bootPerfEnabled(): boolean {
  const flag = process.env.BOOT_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.NODE_ENV === "development";
}

export function bootPerfTimeStart(scope: OrdersBootPerfScope): void {
  if (!bootPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function bootPerfTimeEnd(scope: OrdersBootPerfScope): void {
  if (!bootPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}

export async function bootPerfTimed<T>(scope: OrdersBootPerfScope, fn: () => Promise<T>): Promise<T> {
  bootPerfTimeStart(scope);
  try {
    return await fn();
  } finally {
    bootPerfTimeEnd(scope);
  }
}

export function bootPerfLog(extra: Record<string, unknown>): void {
  if (!bootPerfEnabled()) return;
  console.log("[boot]", { ts: new Date().toISOString(), ...extra });
}
