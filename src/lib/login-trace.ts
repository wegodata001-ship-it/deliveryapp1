/**
 * Full login → dashboard trace for Vercel / production debugging.
 * Enable on Vercel: set env LOGIN_TRACE=1
 * Disable: LOGIN_TRACE=0
 */

export const LOGIN_TRACE_COOKIE = "wego_login_trace";
export const LOGIN_TRACE_HEADER = "x-wego-login-trace";

export type LoginTraceStep =
  | "LOGIN_START"
  | "1.validate"
  | "2.createSession"
  | "3.setCookie"
  | "4.redirect"
  | "5.middleware"
  | "6.requireAuth"
  | "7.adminLayout"
  | "8.adminPage"
  | "9.dashboardStream"
  | "10.firstByte"
  | "11.pageInteractive";

export type LoginTraceContext = {
  traceId: string;
  /** Client wall-clock ms at LOGIN_START (Date.now()) */
  originMs: number;
};

const TIMER_PREFIX = "login.";

/** Active console.time labels per traceId+scope */
const activeTimers = new Map<string, string>();

export function loginTraceEnabled(): boolean {
  const flag = process.env.LOGIN_TRACE?.trim();
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.NODE_ENV === "development";
}

export function createLoginTraceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `lt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function formatLoginTraceHeader(ctx: LoginTraceContext): string {
  return `${ctx.traceId}:${ctx.originMs}`;
}

export function parseLoginTraceHeader(raw: string | null | undefined): LoginTraceContext | null {
  if (!raw?.trim()) return null;
  const [traceId, originRaw] = raw.trim().split(":");
  const originMs = Number(originRaw);
  if (!traceId || !Number.isFinite(originMs)) return null;
  return { traceId, originMs };
}

export function parseLoginTraceCookie(raw: string | null | undefined): LoginTraceContext | null {
  if (!raw?.trim()) return null;
  const [traceId, originRaw] = raw.trim().split(".");
  const originMs = Number(originRaw);
  if (!traceId || !Number.isFinite(originMs)) return null;
  return { traceId, originMs };
}

export function serializeLoginTraceCookie(ctx: LoginTraceContext): string {
  return `${ctx.traceId}.${ctx.originMs}`;
}

export function loginTraceIsoNow(): string {
  return new Date().toISOString();
}

/** Elapsed ms since client LOGIN_START (originMs). */
export function loginTraceSinceOrigin(ctx: LoginTraceContext): number {
  return Math.max(0, Date.now() - ctx.originMs);
}

export function loginTraceRuntimeMeta(): Record<string, unknown> {
  const uptime =
    typeof process !== "undefined" && typeof process.uptime === "function"
      ? Number(process.uptime().toFixed(3))
      : undefined;
  const coldStartLikely = uptime !== undefined && uptime < 2;
  return {
    ts: loginTraceIsoNow(),
    uptimeSec: uptime,
    coldStartLikely,
    vercel: !!process.env.VERCEL,
    vercelRegion: process.env.VERCEL_REGION ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
  };
}

function timerKey(traceId: string, scope: string): string {
  return `${TIMER_PREFIX}${scope}#${traceId}`;
}

export function loginTraceTimeStart(traceId: string, scope: string): void {
  if (!loginTraceEnabled()) return;
  const key = timerKey(traceId, scope);
  if (activeTimers.has(key)) return;
  activeTimers.set(key, key);
  console.time(key);
}

export function loginTraceTimeEnd(traceId: string, scope: string): void {
  if (!loginTraceEnabled()) return;
  const key = timerKey(traceId, scope);
  if (!activeTimers.has(key)) return;
  activeTimers.delete(key);
  console.timeEnd(key);
}

export async function loginTraceTimed<T>(
  traceId: string,
  scope: string,
  fn: () => Promise<T>,
): Promise<T> {
  loginTraceTimeStart(traceId, scope);
  try {
    return await fn();
  } finally {
    loginTraceTimeEnd(traceId, scope);
  }
}

export function loginTraceMark(
  ctx: LoginTraceContext,
  step: LoginTraceStep,
  extra?: Record<string, unknown>,
): void {
  if (!loginTraceEnabled()) return;
  console.log(`[LOGIN_TRACE] ${step}`, {
    traceId: ctx.traceId,
    sinceOriginMs: loginTraceSinceOrigin(ctx),
    ...loginTraceRuntimeMeta(),
    ...(extra ?? {}),
  });
}

export function loginTraceStart(ctx: LoginTraceContext, extra?: Record<string, unknown>): void {
  if (!loginTraceEnabled()) return;
  loginTraceMark(ctx, "LOGIN_START", extra);
}

/** API handler finished (steps 1–3 on server). */
export function loginTraceApiDone(ctx: LoginTraceContext, extra?: Record<string, unknown>): void {
  if (!loginTraceEnabled()) return;
  loginTraceMark(ctx, "3.setCookie", { ...extra, segment: "api.done" });
  loginTraceTimeEnd(ctx.traceId, "api.POST");
}

/** Edge middleware isolate boot (approximate cold start). */
export function loginTraceMiddlewareBootMeta(): { coldStartLikely: boolean; isolateAgeMs: number } {
  const g = globalThis as typeof globalThis & { __wegoLoginMwBootAt?: number };
  const now = Date.now();
  const coldStartLikely = g.__wegoLoginMwBootAt === undefined;
  if (g.__wegoLoginMwBootAt === undefined) g.__wegoLoginMwBootAt = now;
  return { coldStartLikely, isolateAgeMs: now - (g.__wegoLoginMwBootAt ?? now) };
}
