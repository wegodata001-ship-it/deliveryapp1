import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  captureOrderActionForApi,
  updateOrderWorkPanelActionForApi,
  type CaptureState,
} from "@/app/admin/capture/actions";
import { capturePerfLog, capturePerfTimeEnd, capturePerfTimeStart } from "@/lib/capture-perf";
import { perfError } from "@/lib/perf-log";
import { adminSessionCookieName, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  capturePerfTimeStart("capture.total");
  const t0 = Date.now();
  try {
    const sessionT0 = Date.now();
    const token = (await cookies()).get(adminSessionCookieName)?.value;
    const session = token ? await verifySessionToken(token) : null;
    const sessionMs = Date.now() - sessionT0;
    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" } satisfies CaptureState, { status: 401 });
    }

    const bodyT0 = Date.now();
    const body = (await req.json().catch(() => null)) as
      | ({ mode: "create" } & Parameters<typeof captureOrderActionForApi>[0])
      | ({ mode: "update" } & Parameters<typeof updateOrderWorkPanelActionForApi>[0])
      | null;
    const requestJsonMs = Date.now() - bodyT0;

    if (!body) {
      return NextResponse.json({ ok: false, error: "בקשה לא תקינה" } satisfies CaptureState, { status: 400 });
    }

    const { mode, ...payload } = body;
    const actionT0 = Date.now();
    const result =
      mode === "update"
        ? await updateOrderWorkPanelActionForApi(
            payload as Parameters<typeof updateOrderWorkPanelActionForApi>[0],
            session,
          )
        : await captureOrderActionForApi(
            payload as Parameters<typeof captureOrderActionForApi>[0],
            session,
          );
    const actionMs = Date.now() - actionT0;

    const responseJsonT0 = Date.now();
    const response = NextResponse.json(result, { status: result.ok ? 200 : 400 });
    const responseJsonMs = Date.now() - responseJsonT0;

    capturePerfLog({
      mode,
      ok: result.ok,
      apiMs: Date.now() - t0,
      sessionMs,
      requestJsonMs,
      actionMs,
      responseJsonMs,
      hint: "actionMs should match capture save totalMs; apiMs−actionMs ≈ session+JSON; client total−fetchMs ≈ UI",
    });

    return response;
  } catch (error) {
    perfError("api.orders.capture.POST.failed", error);
    const msg = error instanceof Error ? error.message : "שגיאה בשמירה";
    capturePerfLog({ ok: false, apiMs: Date.now() - t0, error: msg });
    return NextResponse.json({ ok: false, error: msg } satisfies CaptureState, { status: 500 });
  } finally {
    capturePerfTimeEnd("capture.total");
  }
}
