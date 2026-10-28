import { NextResponse } from "next/server";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { getFlowExportData } from "@/app/admin/cash-flow/flow-export-data";
import { buildFlowExportPdfHtml } from "@/lib/flow-control/flow-export-build";
import { renderHtmlToPdf } from "@/lib/pdf/browser";
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
    const html = buildFlowExportPdfHtml(data);
    const pdfBytes = await renderHtmlToPdf(html, { landscape: true });
    const baseName = `Flow_Control_${week}`;
    if (pdfBytes) {
      return new Response(new Blob([new Uint8Array(pdfBytes)]), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${baseName}.pdf"`,
        },
      });
    }
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    console.error("[cash-flow-export-pdf]", e);
    return NextResponse.json({ error: "ייצוא נכשל" }, { status: 500 });
  }
}
