/**
 * CASH_FLOW_PERF — מדידת ביצועים לבקרת תזרים.
 * הפעלה: CASH_FLOW_PERF=1 או development.
 */

export type CashFlowPerfScope =
  | "cashFlow.total"
  | "cashFlow.auth"
  | "cashFlow.weekLookup"
  | "cashFlow.openingBalances"
  | "cashFlow.paymentReceipts"
  | "cashFlow.weeklyMovements"
  | "cashFlow.fxPurchases"
  | "cashFlow.cashBalances"
  | "cashFlow.bankBalances"
  | "cashFlow.currentBalances"
  | "cashFlow.aggregation"
  | "cashFlow.turkeyMovements"
  | "cashFlow.bootstrap";

const timers = new Map<string, number>();

export function cashFlowPerfEnabled(): boolean {
  const flag = process.env.CASH_FLOW_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.NODE_ENV === "development";
}

export function cashFlowPerfStart(scope: CashFlowPerfScope): void {
  if (!cashFlowPerfEnabled()) return;
  timers.set(scope, Date.now());
}

export function cashFlowPerfEnd(scope: CashFlowPerfScope): number {
  if (!cashFlowPerfEnabled()) return 0;
  const t0 = timers.get(scope);
  if (t0 == null) return 0;
  timers.delete(scope);
  return Date.now() - t0;
}

export async function cashFlowPerfTimed<T>(scope: CashFlowPerfScope, fn: () => Promise<T>): Promise<T> {
  cashFlowPerfStart(scope);
  try {
    return await fn();
  } finally {
    const ms = cashFlowPerfEnd(scope);
    if (ms > 0) cashFlowPerfLog({ scope, ms });
  }
}

export function cashFlowPerfLog(extra: Record<string, unknown>): void {
  if (!cashFlowPerfEnabled()) return;
  console.info("[CASH_FLOW_PERF]", {
    ts: new Date().toISOString(),
    ...extra,
  });
}

export async function cashFlowPerfRun<T>(
  fn: () => Promise<T>,
  labels?: Record<string, number>,
): Promise<T> {
  cashFlowPerfStart("cashFlow.total");
  try {
    return await fn();
  } finally {
    const totalMs = cashFlowPerfEnd("cashFlow.total");
    if (totalMs > 0) {
      cashFlowPerfLog({
        TOTAL: totalMs,
        ...labels,
      });
    }
  }
}
