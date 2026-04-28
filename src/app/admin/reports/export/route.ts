import { NextResponse } from "next/server";
import { getReportTableAction, type ReportFilters, type ReportKind } from "@/app/admin/reports/actions";
import { generateExcel } from "@/lib/reports-excel";

const ALLOWED_KINDS: ReportKind[] = [
  "openOrdersReport",
  "paymentsByLocationReport",
  "weeklySummaryReport",
  "customerBalanceReport",
  "paymentsByMethodReport",
];

function readFilters(sp: URLSearchParams): ReportFilters {
  return {
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
    customerId: sp.get("customerId") || undefined,
    status: sp.get("status") || undefined,
    paymentMethod: sp.get("paymentMethod") || undefined,
    workWeek: sp.get("workWeek") || undefined,
  };
}

function fileName(kind: ReportKind): string {
  const d = new Date().toISOString().slice(0, 10);
  return `${kind}_${d}.xlsx`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = (searchParams.get("kind") || "") as ReportKind;
    if (!ALLOWED_KINDS.includes(kind)) {
      return NextResponse.json({ ok: false, error: "סוג דוח לא תקין" }, { status: 400 });
    }

    const filters = readFilters(searchParams);
    const report = await getReportTableAction(kind, filters);

    const bodyRows = report.rows.length
      ? report.rows
      : [];
    const summaryRow = new Array(report.columns.length).fill("");
    summaryRow[0] = "סה\"כ";
    if (report.columns.length > 1) summaryRow[1] = report.totals.total;
    if (report.columns.length > 2) summaryRow[2] = report.totals.paid;
    if (report.columns.length > 3) summaryRow[3] = report.totals.remaining;
    const buffer = generateExcel(report.columns, [...bodyRows, summaryRow]);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName(kind)}"`,
      },
    });
  } catch (e) {
    console.error("reports export failed", e);
    return NextResponse.json({ ok: false, error: "שגיאה בייצוא דוח" }, { status: 500 });
  }
}

