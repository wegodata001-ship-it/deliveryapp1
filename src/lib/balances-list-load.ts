/** Shared load-path helpers for the customer balances screen. No financial logic. */

export const BALANCES_FETCH_TIMEOUT_MS = 25_000;
export const BALANCES_TIMEOUT_MESSAGE = "טעינת היתרות נמשכת זמן רב מהרגיל";
export const BALANCES_LOAD_FAILED_MESSAGE = "טעינת היתרות נכשלה";

const TIMEOUT_RE =
  /timeout|timed out|P1002|P1008|P1017|P2024|connection pool|pool timeout|Can't reach database|connect ETIMEDOUT/i;

export function isBalancesTimeoutError(error: unknown): boolean {
  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return TIMEOUT_RE.test(raw) || (error instanceof Error && error.message === BALANCES_TIMEOUT_MESSAGE);
}

export function toSafeBalancesListError(error: unknown): Error {
  if (isBalancesTimeoutError(error)) return new Error(BALANCES_TIMEOUT_MESSAGE);
  return new Error(BALANCES_LOAD_FAILED_MESSAGE);
}

export function safeBalancesErrorLog(error: unknown): { name: string; code?: string; message: string } {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return {
    name,
    ...(code ? { code } : {}),
    message: message
      .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
      .replace(/DATABASE_URL=\S+/gi, "[redacted]")
      .slice(0, 240),
  };
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = BALANCES_TIMEOUT_MESSAGE,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
