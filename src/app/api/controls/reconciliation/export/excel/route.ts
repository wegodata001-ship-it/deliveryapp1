import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { RECON_STATUS_STYLE, type ReconResultRow } from "@/lib/controls/reconcile-core";
import type { ReconExportData } from "@/lib/controls/reconciliation-pdf-html";

// ⚠️ Route זה מייצא Excel בלבד — אסור לייבא playwright / launchPdfBrowser / chromium כאן.
// הפקת PDF נמצאת ב-route נפרד: ../pdf.

export const runtime = "nodejs";

const READ_PERMS = ["view_reports"];

function num(v: number | null): number | string {
  return v == null ? "—" : v;
}

function buildWorkbook(data: ReconExportData): Buffer {
  const wb = XLSX.utils.book_new();

  const summary: (string | number)[][] = [
    ["WEGO — דוח התאמת מערכות"],
    ["שבוע עבודה", data.week],
    ["תאריך הפקה", data.generatedAt.slice(0, 10)],
    [],
    ["", "מספר", "סך סכומים ($)"],
    ["WEGO", data.summary.wegoCount, data.summary.wegoSum],
    ["Excel", data.summary.extCount, data.summary.extSum],
    ["הפרש כספי כולל", data.summary.countDiff, data.summary.diffSum],
    [],
    ["סטטוס", "כמות"],
    ["תואם", data.kpis.matched],
    ["הפרש קטן", data.kpis.diffSmall],
    ["חריגה", data.kpis.diffMedium],
    ["הפרש חמור", data.kpis.diffSevere],
    ["חסר ב-WEGO", data.kpis.missingSystem],
    ["חסר בקובץ", data.kpis.missingExternal],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "סיכום");

  const header = [
    "סטטוס",
    "מס׳ הזמנה (WEGO)",
    "External ID",
    "קוד לקוח",
    "שם לקוח",
    "סכום WEGO",
    "סכום Excel",
    "הפרש",
    "שבוע",
    "תאריך הפקה",
  ];
  const rows: (string | number)[][] = data.rows.map((r) => [
    RECON_STATUS_STYLE[r.status].label,
    r.systemOrderNumber ?? "—",
    r.externalOrderNumber ?? r.systemExternalId ?? "—",
    r.systemCustomerCode ?? r.externalCustomerCode ?? "—",
    r.customerName ?? r.externalCustomerName ?? "—",
    num(r.systemAmount),
    num(r.externalAmount),
    num(r.diff),
    data.week,
    data.generatedAt.slice(0, 10),
  ]);
  const wsRows = XLSX.utils.aoa_to_sheet([header, ...rows]);
  wsRows["!cols"] = [
    { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 22 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsRows, "התאמה");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, READ_PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as
      | { week?: unknown; rows?: unknown; kpis?: unknown; summary?: unknown }
      | null;
    const week = typeof body?.week === "string" ? body.week.trim() : "";
    if (!week) return NextResponse.json({ ok: false, error: "שבוע חסר" }, { status: 400 });
    if (!Array.isArray(body?.rows) || !body?.kpis || !body?.summary) {
      return NextResponse.json({ ok: false, error: "אין נתוני התאמה לייצוא" }, { status: 400 });
    }

    const data: ReconExportData = {
      week,
      generatedAt: new Date().toISOString(),
      kpis: body.kpis as ReconExportData["kpis"],
      summary: body.summary as ReconExportData["summary"],
      rows: body.rows as ReconResultRow[],
    };
    const baseName = `Reconciliation_${week.replace(/[^\w-]/g, "_")}`;
    const buf = buildWorkbook(data);

    return new Response(new Blob([new Uint8Array(buf)]), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[reconciliation-export-excel] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" },
      { status: 500 },
    );
  }
}
