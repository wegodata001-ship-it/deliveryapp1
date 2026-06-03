import { NextResponse } from "next/server";
import {
  updateOrderListPaymentMethodActionForApi,
  type UpdateOrderPaymentMethodApiResult,
} from "@/app/admin/capture/actions";
import { capturePerfLog } from "@/lib/capture-perf";
import { perfError } from "@/lib/perf-log";
import { requireApiAuth } from "@/lib/session-user-guard";

export const runtime = "nodejs";

type Body = {
  orderId?: string;
  paymentMethod?: string | null;
};

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const auth = await requireApiAuth();
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error } satisfies UpdateOrderPaymentMethodApiResult,
        { status: auth.status },
      );
    }
    const { session } = auth;
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "בקשה לא תקינה" } satisfies UpdateOrderPaymentMethodApiResult,
        { status: 400 },
      );
    }
    const orderId = (body.orderId ?? "").trim();
    const paymentMethod = body.paymentMethod ?? null;
    const res = await updateOrderListPaymentMethodActionForApi(orderId, paymentMethod, session);
    capturePerfLog({ kind: "orders.paymentMethod.POST", apiMs: Date.now() - t0, ok: res.ok });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (error) {
    perfError("api.orders.paymentMethod.POST.failed", error);
    return NextResponse.json(
      { ok: false, error: "שגיאה בשמירה" } satisfies UpdateOrderPaymentMethodApiResult,
      { status: 500 },
    );
  }
}

