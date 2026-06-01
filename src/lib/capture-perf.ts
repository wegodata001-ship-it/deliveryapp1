/** Performance logs for POST /api/orders/capture — set CAPTURE_PERF=1 on Vercel. */

export type CapturePerfScope =
  | "capture.total"
  | "capture.auth"
  | "capture.validation"
  | "capture.customer"
  | "capture.exchangeRate"
  | "capture.phase1"
  | "capture.insertOrder"
  | "capture.insertOrderRow"
  | "capture.insertItems"
  | "capture.insertAudit"
  | "capture.audit"
  | "capture.notifications"
  | "capture.refresh"
  | "capture.response"
  | "capture.generateOrderNumber"
  | "capture.loadSettings"
  | "capture.auditInsert";

const timers = new Set<string>();

export function capturePerfEnabled(): boolean {
  const flag = process.env.CAPTURE_PERF?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.NODE_ENV === "development";
}

export function capturePerfTimeStart(scope: CapturePerfScope): void {
  if (!capturePerfEnabled()) return;
  if (timers.has(scope)) return;
  timers.add(scope);
  console.time(scope);
}

export function capturePerfTimeEnd(scope: CapturePerfScope): void {
  if (!capturePerfEnabled() || !timers.has(scope)) return;
  timers.delete(scope);
  console.timeEnd(scope);
}

export async function capturePerfTimed<T>(scope: CapturePerfScope, fn: () => Promise<T>): Promise<T> {
  capturePerfTimeStart(scope);
  try {
    return await fn();
  } finally {
    capturePerfTimeEnd(scope);
  }
}

/** Audit — לא חוסם את תשובת ה-API; מודד זמן ה-INSERT בפועל */
export function scheduleCaptureAuditInsert(work: () => Promise<unknown>): void {
  if (!capturePerfEnabled()) {
    void work().catch(() => {});
    return;
  }
  const t0 = Date.now();
  capturePerfTimeStart("capture.auditInsert");
  void work()
    .catch(() => {})
    .finally(() => {
      capturePerfTimeEnd("capture.auditInsert");
      capturePerfLog({ auditInsertMs: Date.now() - t0 });
    });
}

export function capturePerfLog(extra: Record<string, unknown>): void {
  if (!capturePerfEnabled()) return;
  const uptime =
    typeof process !== "undefined" && typeof process.uptime === "function"
      ? Number(process.uptime().toFixed(3))
      : undefined;
  console.log("[capture]", {
    ts: new Date().toISOString(),
    uptimeSec: uptime,
    coldStartLikely: uptime !== undefined && uptime < 2,
    vercel: !!process.env.VERCEL,
    ...extra,
  });
}
