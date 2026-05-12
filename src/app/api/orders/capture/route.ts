import { NextResponse } from "next/server";
import {
  captureOrderAction,
  updateOrderWorkPanelAction,
  type CaptureState,
} from "@/app/admin/capture/actions";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withPerfTimer("api.orders.capture.POST", async () => {
    try {
      const body = (await req.json().catch(() => null)) as
        | ({ mode: "create" } & Parameters<typeof captureOrderAction>[0])
        | ({ mode: "update" } & Parameters<typeof updateOrderWorkPanelAction>[0])
        | null;

      if (!body) {
        return NextResponse.json({ ok: false, error: "בקשה לא תקינה" } satisfies CaptureState, { status: 400 });
      }

      const { mode, ...payload } = body;
      const result =
        mode === "update"
          ? await updateOrderWorkPanelAction(payload as Parameters<typeof updateOrderWorkPanelAction>[0])
          : await captureOrderAction(payload as Parameters<typeof captureOrderAction>[0]);

      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    } catch (error) {
      perfError("api.orders.capture.POST.failed", error);
      const msg = error instanceof Error ? error.message : "שגיאה בשמירה";
      return NextResponse.json({ ok: false, error: msg } satisfies CaptureState, { status: 500 });
    }
  });
}
