import { NextResponse } from "next/server";
import { updateOrderListStatusActionForApi, type UpdateOrderListStatusApiResult } from "@/app/admin/capture/actions";
import { capturePerfLog, logOrderStatusUpdatePerf } from "@/lib/capture-perf";
import { perfError } from "@/lib/perf-log";
import { invalidateOrdersListDataCache } from "@/lib/orders-list-data";
import { requireApiAuth } from "@/lib/session-user-guard";

export const runtime = "nodejs";

type Body = {
  orderId?: string;
  status?: string;
};

export async function POST(req: Request) {
  const startedAt = performance.now();
  try {
    const authT0 = performance.now();
    const auth = await requireApiAuth();
    const authMs = Math.round(performance.now() - authT0);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error } satisfies UpdateOrderListStatusApiResult,
        { status: auth.status },
      );
    }
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "בקשה לא תקינה" } satisfies UpdateOrderListStatusApiResult, { status: 400 });
    }
    const orderId = (body.orderId ?? "").trim();
    const status = (body.status ?? "").trim();
    const res = await updateOrderListStatusActionForApi(orderId, status, auth.user, { AUTH_MS: authMs });
    if (res.ok) invalidateOrdersListDataCache();
    const totalMs = Math.round(performance.now() - startedAt);
    capturePerfLog({ kind: "orders.status.POST", apiMs: totalMs, ok: res.ok });
    if (!res.ok) {
      logOrderStatusUpdatePerf({
        AUTH_MS: authMs,
        FIND_ORDER_MS: 0,
        UPDATE_ORDER_MS: 0,
        RECALC_BALANCES_MS: 0,
        REFRESH_DATA_MS: 0,
        TOTAL_MS: totalMs,
      });
    }
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (error) {
    perfError("api.orders.status.POST.failed", error);
    return NextResponse.json({ ok: false, error: "שגיאה בשמירה" } satisfies UpdateOrderListStatusApiResult, { status: 500 });
  }
}
