import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { getCashExportData } from "@/app/admin/cash-control/export-data";
import { buildCashControlWorkbook } from "@/lib/controls/cash-control-excel";

// ⚠️ Route זה מייצא Excel בלבד — אסור לייבא playwright / launchPdfBrowser / chromium כאן.
// הפקת PDF נמצאת ב-route נפרד: ../pdf. כך פונקציית ה-Excel נשארת קטנה (<50MB).

export const runtime = "nodejs";

const READ_PERMS = ["view_payment_control"];

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, READ_PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as { week?: unknown } | null;
    const week = typeof body?.week === "string" ? body.week.trim() : "";
    if (!week) {
      return NextResponse.json({ ok: false, error: "שבוע חסר" }, { status: 400 });
    }

    const data = await getCashExportData(week);
    const baseName = `Cash_Control_${week.replace(/[^\w-]/g, "_")}`;
    const buf = buildCashControlWorkbook(data);

    return new Response(new Blob([new Uint8Array(buf)]), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[cash-control-export-excel] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" },
      { status: 500 },
    );
  }
}
