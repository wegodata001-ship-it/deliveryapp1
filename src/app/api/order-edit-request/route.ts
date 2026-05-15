import { NextResponse } from "next/server";
import { createOrderEditRequestAction } from "@/app/admin/order-edit-requests/actions";
import { getSessionPayload } from "@/lib/admin-auth";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

/**
 * POST /api/order-edit-request
 * גוף JSON: { "orderId": string, "reason": string }
 * שכבת API לבקשת אישור עריכה (מקביל ל־createOrderEditRequestAction).
 */
export async function POST(req: Request) {
  return withPerfTimer("api.order-edit-request.POST", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: "גוף בקשה לא תקין" }, { status: 400 });
      }
      const rec = body as Record<string, unknown>;
      const orderId = String(rec.orderId ?? "").trim();
      const reason = String(rec.reason ?? rec.requestReason ?? "").trim();
      if (!orderId) {
        return NextResponse.json({ error: "חסר orderId" }, { status: 400 });
      }

      const res = await createOrderEditRequestAction(orderId, reason);
      if (!res.ok) {
        const lower = res.error.toLowerCase();
        const status =
          lower.includes("אין הרשאה") || lower.includes("מנהלים יכולים")
            ? 403
            : lower.includes("לא נמצא")
              ? 404
              : 400;
        return NextResponse.json({ error: res.error }, { status });
      }

      return NextResponse.json({ ok: true });
    } catch (error) {
      perfError("api.order-edit-request.POST.failed", error);
      return NextResponse.json({ error: "שמירת בקשה נכשלה" }, { status: 500 });
    }
  });
}
