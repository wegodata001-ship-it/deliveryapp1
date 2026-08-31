import { NextRequest, NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { buildOrderCommissionDetailView } from "@/lib/order-commission-ssot";

export async function GET(req: NextRequest) {
  const me = await requireAuth();
  if (!userHasAnyPermission(me, ["receive_payments", "view_orders", "edit_orders"])) {
    return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
  }

  const orderId = (req.nextUrl.searchParams.get("orderId") ?? "").trim();
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "חסר מזהה הזמנה" }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, orderNumber: true, commissionUsd: true, customerId: true },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "הזמנה לא נמצאה" }, { status: 404 });
  }

  const fees = await prisma.paymentAdjustmentFee.findMany({
    where: { orderId, status: { not: "CANCELLED" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      orderId: true,
      paymentId: true,
      amountUsd: true,
      userChoice: true,
      reason: true,
      createdAt: true,
      paymentCaptureCode: true,
      notes: true,
      createdBy: { select: { fullName: true } },
      payment: { select: { id: true, paymentCode: true } },
    },
  });

  const detail = buildOrderCommissionDetailView({
    orderId: order.id,
    orderNumber: order.orderNumber,
    baseCommissionUsd: Number(order.commissionUsd ?? 0),
    fees: fees.map((f) => ({
      id: f.id,
      amountUsd: Number(f.amountUsd ?? 0),
      userChoice: f.userChoice,
      reason: f.reason,
      createdAt: f.createdAt,
      paymentId: f.paymentId ?? f.payment?.id ?? null,
      paymentCaptureCode: f.paymentCaptureCode,
      paymentCode: f.payment?.paymentCode ?? null,
      orderId: f.orderId ?? order.id,
      orderNumber: order.orderNumber,
      notes: f.notes,
      createdByName: f.createdBy?.fullName ?? null,
    })),
  });

  return NextResponse.json({ ok: true, detail });
}
