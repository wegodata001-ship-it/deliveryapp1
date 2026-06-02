import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  updateOrderListPaymentMethodActionForApi,
  type UpdateOrderPaymentMethodApiResult,
} from "@/app/admin/capture/actions";
import { capturePerfLog } from "@/lib/capture-perf";
import { perfError } from "@/lib/perf-log";
import { adminSessionCookieName, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

type Body = {
  orderId?: string;
  paymentMethod?: string | null;
};

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const token = (await cookies()).get(adminSessionCookieName)?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" } satisfies UpdateOrderPaymentMethodApiResult,
        { status: 401 },
      );
    }
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

