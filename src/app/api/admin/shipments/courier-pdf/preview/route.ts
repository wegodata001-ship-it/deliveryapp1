import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission, isAdminUser } from "@/lib/admin-auth";
import { backfillDeliveryLocationArabicNames, buildCourierPdfPreviewRowsForRecordIds } from "@/lib/shipment-courier-pdf-data";

export const runtime = "nodejs";

const PERMS = ["manage_shipments", "view_shipments"];

type Body = {
  recordIds?: string[];
};

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!isAdminUser(me) && !userHasAnyPermission(me, PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    const recordIds = Array.from(new Set((body?.recordIds ?? []).filter(Boolean)));

    if (recordIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "יש לבחור לפחות משלוח אחד." },
        { status: 400 },
      );
    }

    try {
      await backfillDeliveryLocationArabicNames();
    } catch (e) {
      console.warn("[courier-pdf-preview] location arabic backfill skipped", e);
    }

    const rows = await buildCourierPdfPreviewRowsForRecordIds(recordIds, {
      persistAutoCache: true,
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    console.error("[courier-pdf-preview] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "טעינת תצוגה מקדימה נכשלה" },
      { status: 500 },
    );
  }
}
