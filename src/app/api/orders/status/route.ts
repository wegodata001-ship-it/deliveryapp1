import { NextResponse } from "next/server";
import { updateOrderListStatusActionForApi, type UpdateOrderListStatusApiResult } from "@/app/admin/capture/actions";
import { capturePerfLog } from "@/lib/capture-perf";
import { perfError } from "@/lib/perf-log";
import { requireApiAuth } from "@/lib/session-user-guard";

export const runtime = "nodejs";

type Body = {
  orderId?: string;
  status?: string;
};

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const auth = await requireApiAuth();
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error } satisfies UpdateOrderListStatusApiResult,
        { status: auth.status },
      );
    }
    const { session } = auth;
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "בקשה לא תקינה" } satisfies UpdateOrderListStatusApiResult, { status: 400 });
    }
    const orderId = (body.orderId ?? "").trim();
    const status = (body.status ?? "").trim();
    const res = await updateOrderListStatusActionForApi(orderId, status, session);
    capturePerfLog({ kind: "orders.status.POST", apiMs: Date.now() - t0, ok: res.ok });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (error) {
    perfError("api.orders.status.POST.failed", error);
    return NextResponse.json({ ok: false, error: "שגיאה בשמירה" } satisfies UpdateOrderListStatusApiResult, { status: 500 });
  }
}

