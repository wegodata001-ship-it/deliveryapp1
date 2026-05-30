import { NextResponse } from "next/server";
import { attemptLogin, safeLoginNext } from "@/lib/login-auth";
import { perfError } from "@/lib/perf-log";
import {
  LOGIN_TRACE_COOKIE,
  LOGIN_TRACE_HEADER,
  createLoginTraceId,
  formatLoginTraceHeader,
  loginTraceApiDone,
  loginTraceRuntimeMeta,
  loginTraceStart,
  loginTraceTimed,
  loginTraceTimeStart,
  parseLoginTraceHeader,
  serializeLoginTraceCookie,
  type LoginTraceContext,
} from "@/lib/login-trace";

export const runtime = "nodejs";

type LoginBody = {
  username?: string;
  password?: string;
  next?: string;
};

function resolveTrace(req: Request): LoginTraceContext {
  const fromHeader = parseLoginTraceHeader(req.headers.get(LOGIN_TRACE_HEADER));
  if (fromHeader) return fromHeader;
  return { traceId: createLoginTraceId(), originMs: Date.now() };
}

/** התחברות — JSON בלבד, ללא רענון RSC של דף login. */
export async function POST(req: Request) {
  const trace = resolveTrace(req);
  loginTraceStart(trace, { phase: "api", ...loginTraceRuntimeMeta() });
  loginTraceTimeStart(trace.traceId, "api.POST");

  try {
    const body = (await req.json()) as LoginBody;
    const username = body.username ?? "";
    const password = body.password ?? "";
    const next = safeLoginNext(body.next);

    const result = await loginTraceTimed(trace.traceId, "api.POST", () =>
      attemptLogin(username, password, next, trace),
    );

    if (!result.ok) {
      loginTraceApiDone(trace, { ok: false, status: 401 });
      return NextResponse.json({ ok: false as const, error: result.error }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true as const, redirectTo: result.redirectTo });
    res.headers.set(LOGIN_TRACE_HEADER, formatLoginTraceHeader(trace));
    res.cookies.set(LOGIN_TRACE_COOKIE, serializeLoginTraceCookie(trace), {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 120,
    });
    loginTraceApiDone(trace, { ok: true, redirectTo: result.redirectTo });
    return res;
  } catch (error) {
    perfError("login.api.POST.failed", error);
    loginTraceApiDone(trace, { ok: false, error: "exception" });
    return NextResponse.json(
      { ok: false as const, error: "בעיה בחיבור לשרת. נסו שוב." },
      { status: 500 },
    );
  }
}
