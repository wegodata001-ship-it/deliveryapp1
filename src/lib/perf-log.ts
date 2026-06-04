const PERF_ENABLED =
  process.env.DEBUG_PERF_LOGS === "1" ||
  process.env.DEBUG_PERF_LOGS === "true" ||
  process.env.NODE_ENV !== "production";

export function perfEnabled(): boolean {
  return PERF_ENABLED;
}

export function perfNowLabel(scope: string): string {
  return `[perf] ${scope}`;
}

/** redirect() / notFound() — לא שגיאה אמיתית; לא לוגים כ-[perf] error */
export function isNextNavigationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  const digest = String((error as { digest: unknown }).digest);
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND");
}

export function perfError(scope: string, error: unknown, extra?: Record<string, unknown>): void {
  if (!PERF_ENABLED) return;
  console.error(perfNowLabel(scope), {
    error: error instanceof Error ? error.message : String(error),
    ...(extra ?? {}),
  });
}

let perfTimerSeq = 0;

export function perfTimeStart(scope: string): string {
  if (!PERF_ENABLED) return "";
  const label = perfNowLabel(`${scope}#${++perfTimerSeq}`);
  console.time(label);
  return label;
}

export function perfTimeEnd(label: string): void {
  if (!PERF_ENABLED || !label) return;
  console.timeEnd(label);
}

export async function withPerfTimer<T>(scope: string, fn: () => Promise<T>): Promise<T> {
  if (!PERF_ENABLED) {
    return fn();
  }
  const label = perfTimeStart(scope);
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const out = await fn();
    return out;
  } catch (error) {
    if (!isNextNavigationError(error)) {
      perfError(scope, error);
    }
    throw error;
  } finally {
    perfTimeEnd(label);
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const durationMs = Math.max(0, endedAt - startedAt);
    console.log(perfNowLabel(scope), { durationMs: Number(durationMs.toFixed(2)) });
  }
}
