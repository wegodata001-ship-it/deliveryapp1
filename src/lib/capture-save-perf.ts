import { capturePerfEnabled, capturePerfLog } from "@/lib/capture-perf";

/** מדידת שלבי שמירת הזמנה — מודפס ללוג בסיום הבקשה */
export class CaptureSavePerf {
  readonly startedAt = Date.now();

  validateInputMs = 0;
  phase1Ms = 0;
  exchangeRateMs = 0;
  createOrderMs = 0;
  createItemsMs = 0;
  updateCustomerMs = 0;
  /** זמן תזמון audit ברקע (לא כולל INSERT) */
  auditMs = 0;
  revalidateMs = 0;
  cacheRefreshMs = 0;
  responseSerializationMs = 0;
  authMs = 0;

  async time<T>(bucket: keyof CaptureSavePerfTimings, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      this[bucket] += Date.now() - t0;
    }
  }

  add(bucket: keyof CaptureSavePerfTimings, ms: number): void {
    if (ms > 0) this[bucket] += ms;
  }

  logSummary(extra?: Record<string, unknown>): void {
    if (!capturePerfEnabled()) return;

    const totalMs = Date.now() - this.startedAt;
    const accounted =
      this.validateInputMs +
      this.phase1Ms +
      this.exchangeRateMs +
      this.createOrderMs +
      this.createItemsMs +
      this.updateCustomerMs +
      this.auditMs +
      this.revalidateMs +
      this.cacheRefreshMs +
      this.responseSerializationMs +
      this.authMs;
    const unaccountedMs = Math.max(0, totalMs - accounted);

    const core = {
      createOrderMs: this.createOrderMs,
      createItemsMs: this.createItemsMs,
      updateCustomerMs: this.updateCustomerMs,
      auditMs: this.auditMs,
      revalidateMs: this.revalidateMs,
      totalMs,
    };

    console.log(core);

    capturePerfLog({
      ...core,
      validateInputMs: this.validateInputMs,
      phase1Ms: this.phase1Ms,
      exchangeRateMs: this.exchangeRateMs,
      cacheRefreshMs: this.cacheRefreshMs,
      responseSerializationMs: this.responseSerializationMs,
      authMs: this.authMs,
      unaccountedMs,
      hint: "unaccountedMs ≈ sync compute + gaps between timers; deferred revalidate logs separately",
      ...extra,
    });
  }
}

type CaptureSavePerfTimings = Pick<
  CaptureSavePerf,
  | "validateInputMs"
  | "phase1Ms"
  | "exchangeRateMs"
  | "createOrderMs"
  | "createItemsMs"
  | "updateCustomerMs"
  | "auditMs"
  | "revalidateMs"
  | "cacheRefreshMs"
  | "responseSerializationMs"
  | "authMs"
>;
