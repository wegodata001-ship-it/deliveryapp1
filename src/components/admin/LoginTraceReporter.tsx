"use client";

import { useEffect } from "react";
import {
  LOGIN_TRACE_COOKIE,
  loginTraceIsoNow,
  loginTraceMark,
  parseLoginTraceCookie,
  type LoginTraceContext,
} from "@/lib/login-trace";

const SESSION_KEY = "wego_login_trace";

function readTraceContext(): LoginTraceContext | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LoginTraceContext;
      if (parsed?.traceId && typeof parsed.originMs === "number") return parsed;
    }
  } catch {
    /* ignore */
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOGIN_TRACE_COOKIE}=([^;]*)`));
  if (match?.[1]) {
    return parseLoginTraceCookie(decodeURIComponent(match[1]));
  }
  return null;
}

function clientLog(step: string, ctx: LoginTraceContext, extra?: Record<string, unknown>): void {
  const sinceOriginMs = Math.max(0, Date.now() - ctx.originMs);
  console.log(`[LOGIN_TRACE] ${step}`, {
    traceId: ctx.traceId,
    sinceOriginMs,
    ts: loginTraceIsoNow(),
    side: "client",
    ...(extra ?? {}),
  });
  console.timeEnd(`login.${step}#${ctx.traceId}`);
}

/**
 * Steps 4 (redirect end), 10 (first byte), 11 (page interactive) — browser console + Network tab hints.
 */
export function LoginTraceReporter() {
  useEffect(() => {
    const ctx = readTraceContext();
    if (!ctx) return;

    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;

    if (nav) {
      clientLog("10.firstByte", ctx, {
        hint: "Network: document request — compare duration to sinceOriginMs",
        ttfbMs: Math.round(nav.responseStart - nav.requestStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        loadEventMs: Math.round(nav.loadEventEnd - nav.startTime),
        transferSize: nav.transferSize,
        deliveryType: (nav as PerformanceNavigationTiming & { deliveryType?: string }).deliveryType,
      });
    } else {
      clientLog("10.firstByte", ctx, { hint: "No PerformanceNavigationTiming (SPA?)" });
    }

    const onInteractive = () => {
      try {
        console.timeEnd(`login.redirect#${ctx.traceId}`);
      } catch {
        /* timer may not exist */
      }
      loginTraceMark(ctx, "11.pageInteractive", {
        hint: "Shell painted — check slow RSC/flight requests in Network (Type: fetch, _rsc)",
      });
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* ignore */
      }
      try {
        console.timeEnd(`login.total#${ctx.traceId}`);
      } catch {
        /* ignore */
      }
    };

    if (document.readyState === "complete") {
      requestAnimationFrame(() => requestAnimationFrame(onInteractive));
    } else {
      window.addEventListener(
        "load",
        () => requestAnimationFrame(() => requestAnimationFrame(onInteractive)),
        { once: true },
      );
    }

    return () => {
      window.removeEventListener("load", onInteractive);
    };
  }, []);

  return null;
}
