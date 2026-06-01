/** Performance logs for payment entry/navigation APIs — PAYMENTS_PERF=1 */

export function paymentsPerfEnabled(): boolean {
  const flag = process.env.PAYMENTS_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.DEBUG_PERF_LOGS === "1" || process.env.DEBUG_PERF_LOGS === "true" || process.env.NODE_ENV === "development";
}

export type PaymentsPerfScope = "payments.entry.db" | "payments.entry.transform" | "payments.navigation.db";

const timers = new Set<string>();

export function paymentsPerfTimeStart(scope: PaymentsPerfScope): void {
  if (!paymentsPerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function paymentsPerfTimeEnd(scope: PaymentsPerfScope): void {
  if (!paymentsPerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}
