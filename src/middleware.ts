import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ROUTE_MODE_HEADER, isLightAdminPath } from "@/lib/admin-route-mode";
import {
  LOGIN_TRACE_COOKIE,
  loginTraceEnabled,
  loginTraceMark,
  loginTraceMiddlewareBootMeta,
  loginTraceRuntimeMeta,
  loginTraceTimeEnd,
  loginTraceTimeStart,
  parseLoginTraceCookie,
} from "@/lib/login-trace";
import { adminSessionCookieName, verifySessionToken } from "@/lib/session";
import { perfError, withPerfTimer } from "@/lib/perf-log";

const g = globalThis as typeof globalThis & { __wegoLoginMwHits?: Map<string, number> };

function middlewareHitCount(traceId: string): number {
  if (!g.__wegoLoginMwHits) g.__wegoLoginMwHits = new Map();
  const n = (g.__wegoLoginMwHits.get(traceId) ?? 0) + 1;
  g.__wegoLoginMwHits.set(traceId, n);
  if (g.__wegoLoginMwHits.size > 200) {
    const first = g.__wegoLoginMwHits.keys().next().value;
    if (first) g.__wegoLoginMwHits.delete(first);
  }
  return n;
}

export async function middleware(request: NextRequest) {
  const trace = loginTraceEnabled()
    ? parseLoginTraceCookie(request.cookies.get(LOGIN_TRACE_COOKIE)?.value)
    : null;

  if (trace) {
    loginTraceTimeStart(trace.traceId, "middleware");
  }

  return withPerfTimer("auth.middleware", async () => {
    try {
      const token = request.cookies.get(adminSessionCookieName)?.value;
      const session = token ? await verifySessionToken(token) : null;

      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        const login = new URL("/admin-login", request.url);
        login.searchParams.set("next", request.nextUrl.pathname);
        return NextResponse.redirect(login);
      }

      const requestHeaders = new Headers(request.headers);
      if (isLightAdminPath(request.nextUrl.pathname)) {
        requestHeaders.set(ADMIN_ROUTE_MODE_HEADER, "light");
      }

      if (trace) {
        const boot = loginTraceMiddlewareBootMeta();
        const hit = middlewareHitCount(trace.traceId);
        loginTraceMark(trace, "5.middleware", {
          path: request.nextUrl.pathname,
          hit,
          isRsc: request.headers.get("rsc") === "1",
          nextRouterPrefetch: request.headers.get("Next-Router-Prefetch") ?? null,
          purpose: request.headers.get("purpose") ?? null,
          ...boot,
          ...loginTraceRuntimeMeta(),
        });
        loginTraceTimeEnd(trace.traceId, "middleware");
      }

      return NextResponse.next({
        request: { headers: requestHeaders },
      });
    } catch (error) {
      perfError("auth.middleware.failed", error, { path: request.nextUrl.pathname });
      const login = new URL("/admin-login", request.url);
      login.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(login);
    }
  });
}

export const config = {
  matcher: ["/admin/:path*"],
};
