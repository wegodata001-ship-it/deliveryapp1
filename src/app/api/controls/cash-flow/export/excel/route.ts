import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { getFlowExportData } from "@/app/admin/cash-flow/flow-export-data";
import { buildFlowExportWorkbook } from "@/lib/flow-control/flow-export-build";
import { DEFAULT_WORK_COUNTRY } from "@/lib/work-country";

export const runtime = "nodejs";

const READ_PERMS = ["view_payment_control", "cashflow.view"];

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, READ_PERMS)) {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
    const body = (await req.json()) as { week?: string; workCountry?: string };
    const week = body.week?.trim();
    if (!week) return NextResponse.json({ error: "חסר שבוע" }, { status: 400 });
    const data = await getFlowExportData(week, (body.workCountry as typeof DEFAULT_WORK_COUNTRY) ?? DEFAULT_WORK_COUNTRY);
    if (!data) return NextResponse.json({ error: "שבוע לא נמצא" }, { status: 404 });
    const buf = buildFlowExportWorkbook(data);
    return new Response(new Blob([new Uint8Array(buf)]), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Flow_Control_${week}.xlsx"`,
      },
    });
  } catch (e) {
    console.error("[cash-flow-export-excel]", e);
    return NextResponse.json({ error: "ייצוא נכשל" }, { status: 500 });
  }
}
