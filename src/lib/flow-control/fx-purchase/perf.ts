/** FX purchase — server-side performance instrumentation (diagnostic). */

export type FxPurchasePerfTimings = {
  authMs?: number;
  snapshotMs?: number;
  receiptsMs?: number;
  allocationMs?: number;
  gateMs?: number;
  persistMs?: number;
  auditDbMs?: number;
  transactionMs?: number;
  revalidateMs?: number;
  totalMs: number;
};

export function createFxPerfTimer() {
  const t0 = Date.now();
  const marks = new Map<string, number>();

  return {
    mark(label: string) {
      marks.set(label, Date.now() - t0);
    },
    finish(extra?: Partial<FxPurchasePerfTimings>): FxPurchasePerfTimings {
      const out: FxPurchasePerfTimings = { totalMs: Date.now() - t0, ...extra };
      for (const [key, ms] of marks) {
        (out as Record<string, number>)[`${key}Ms`] = ms;
      }
      return out;
    },
  };
}

export function logFxPurchasePerf(
  phase: "save" | "update" | "persist" | "action",
  timings: FxPurchasePerfTimings,
): void {
  console.info(`[fx-purchase-perf:${phase}]`, JSON.stringify(timings));
}
