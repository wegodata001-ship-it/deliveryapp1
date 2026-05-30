"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Lock, User } from "lucide-react";
import {
  LOGIN_TRACE_HEADER,
  createLoginTraceId,
  formatLoginTraceHeader,
  loginTraceIsoNow,
} from "@/lib/login-trace";

const SESSION_KEY = "wego_login_trace";

type LoginApiResponse =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const form = e.currentTarget;
      const fd = new FormData(form);
      const username = fd.get("username")?.toString().trim() ?? "";
      const password = fd.get("password")?.toString() ?? "";

      if (!username || !password) {
        setError("נא למלא שם משתמש וסיסמה");
        return;
      }

      setError(null);
      setPending(true);

      const traceId = createLoginTraceId();
      const originMs = Date.now();
      const traceHeader = formatLoginTraceHeader({ traceId, originMs });

      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ traceId, originMs }));
      } catch {
        /* ignore */
      }

      console.log("[LOGIN_TRACE] LOGIN_START", {
        traceId,
        sinceOriginMs: 0,
        ts: loginTraceIsoNow(),
        side: "client",
      });
      console.time(`login.total#${traceId}`);
      console.time(`login.api#${traceId}`);

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [LOGIN_TRACE_HEADER]: traceHeader,
          },
          credentials: "include",
          signal: ac.signal,
          body: JSON.stringify({ username, password, next: nextPath }),
        });

        console.timeEnd(`login.api#${traceId}`);

        const data = (await res.json()) as LoginApiResponse;

        if (ac.signal.aborted) return;

        if (!data.ok) {
          setError(data.error || "שם משתמש או סיסמה שגויים");
          console.timeEnd(`login.total#${traceId}`);
          try {
            sessionStorage.removeItem(SESSION_KEY);
          } catch {
            /* ignore */
          }
          return;
        }

        console.log("[LOGIN_TRACE] 4.redirect", {
          traceId,
          sinceOriginMs: Date.now() - originMs,
          ts: loginTraceIsoNow(),
          side: "client",
          redirectTo: data.redirectTo,
          hint: "Next: full document navigation — watch Network tab for slow /admin document + RSC flights",
        });
        console.time(`login.redirect#${traceId}`);
        window.location.assign(data.redirectTo);
      } catch (err) {
        if (ac.signal.aborted) return;
        console.timeEnd(`login.api#${traceId}`);
        console.timeEnd(`login.total#${traceId}`);
        setError("בעיה בחיבור לשרת. נסו שוב.");
      } finally {
        if (!ac.signal.aborted) {
          setPending(false);
        }
      }
    },
    [nextPath],
  );

  return (
    <form className="al-form" onSubmit={onSubmit}>
      <input type="hidden" name="next" value={nextPath} />
      {error ? (
        <div className="al-error" role="alert" aria-live="assertive">
          {error}
        </div>
      ) : null}
      <div className="al-field">
        <label htmlFor="username">שם משתמש</label>
        <div className="al-input-wrap">
          <span className="al-input-icon" aria-hidden>
            <User size={20} strokeWidth={2} />
          </span>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
            disabled={pending}
          />
        </div>
      </div>
      <div className="al-field">
        <label htmlFor="password">סיסמה</label>
        <div className="al-input-wrap">
          <span className="al-input-icon" aria-hidden>
            <Lock size={20} strokeWidth={2} />
          </span>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
          />
        </div>
      </div>
      <button className="al-submit" type="submit" disabled={pending} aria-busy={pending}>
        {pending ? (
          <>
            <Loader2 className="al-spin" size={18} aria-hidden />
            בודק…
          </>
        ) : (
          "כניסה"
        )}
      </button>
    </form>
  );
}
