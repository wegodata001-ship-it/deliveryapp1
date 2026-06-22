import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import {
  parseExternalReconFile,
  reconcile,
  type SystemOrderForRecon,
} from "@/lib/controls/reconciliation";

export const runtime = "nodejs";

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, ["view_reports"])) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const week = String(form.get("week") ?? "").trim();
    const matchType = String(form.get("matchType") ?? "").trim();

    if (!week) {
      return NextResponse.json({ ok: false, error: "לא נבחר שבוע עבודה" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "לא התקבל קובץ" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const externalRows = parseExternalReconFile(buffer);
    if (externalRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "לא נמצאו שורות נתונים בקובץ. ודא שקיימות עמודות: קוד לקוח / מספר הזמנה / סכום." },
        { status: 400 },
      );
    }

    const orders = await prisma.order.findMany({
      where: { weekCode: week, isActive: true, deletedAt: null },
      select: {
        orderNumber: true,
        customerCodeSnapshot: true,
        customerNameSnapshot: true,
        totalUsd: true,
        amountUsd: true,
        orderDate: true,
        customer: { select: { customerCode: true, displayName: true } },
      },
    });

    const systemOrders: SystemOrderForRecon[] = orders.map((o) => ({
      orderNumber: o.orderNumber,
      customerCode: o.customerCodeSnapshot ?? o.customer?.customerCode ?? null,
      customerName: o.customerNameSnapshot ?? o.customer?.displayName ?? null,
      amount: toNumber(o.totalUsd) ?? toNumber(o.amountUsd),
      dateIso: o.orderDate ? o.orderDate.toISOString() : null,
    }));

    const { rows, kpis } = reconcile(systemOrders, externalRows);

    return NextResponse.json({
      ok: true,
      week,
      matchType,
      fileName: file.name,
      kpis,
      rows,
    });
  } catch (err) {
    console.error("reconciliation failed", err);
    return NextResponse.json({ ok: false, error: "שגיאה בביצוע ההתאמה" }, { status: 500 });
  }
}
