import { NextResponse } from "next/server";
import { getReportTableAction, type ReportFilters, type ReportKind } from "@/app/admin/reports/actions";
import { generateExcel } from "@/lib/reports-excel";
import { withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

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
    sourceCountry: sp.get("sourceCountry") || sp.get("country") || undefined,
  };
}

function fileName(kind: ReportKind): string {
  const d = new Date().toISOString().slice(0, 10);
  return `${kind}_${d}.xlsx`;
}

export async function GET(req: Request) {
  return withPerfTimer("api.reports.export.GET", async () => {
    try {
      const { searchParams } = new URL(req.url);
      const kind = (searchParams.get("kind") || "") as ReportKind;
      if (!ALLOWED_KINDS.includes(kind)) {
        return NextResponse.json({ ok: false, error: "סוג דוח לא תקין" }, { status: 400 });
      }

      const filters = readFilters(searchParams);
      const report = await getReportTableAction(kind, filters);

      const bodyRows = report.rows.length ? report.rows : [];
      const colCount = report.columns.length;
      const summaryRow = new Array(colCount).fill("");
      summaryRow[0] = "סה\"כ";
      if (colCount > 1) summaryRow[1] = report.totals.total;
      if (colCount > 2) summaryRow[2] = report.totals.paid;
      if (colCount > 3) summaryRow[3] = report.totals.remaining;
      const padLine = (text: string) => [text, ...new Array(Math.max(0, colCount - 1)).fill("")];
      const prefixRows = [...(report.exportHeaderLines?.map(padLine) ?? [])];
      const buffer = generateExcel(report.columns, [...bodyRows, summaryRow], prefixRows.length ? prefixRows : undefined);
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
  });
}

