import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { launchPdfBrowser } from "@/lib/playwright-pdf-browser";
import { RECON_STATUS_STYLE, type ReconResultRow } from "@/lib/controls/reconcile-core";
import {
  buildReconciliationPdfHtml,
  type ReconExportData,
} from "@/lib/controls/reconciliation-pdf-html";

export const runtime = "nodejs";

const READ_PERMS = ["view_reports"];

function num(v: number | null): number | string {
  return v == null ? "—" : v;
}

async function loadHebrewFont(): Promise<string> {
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansHebrew-Regular.ttf");
  const bytes = await readFile(fontPath);
  return bytes.toString("base64");
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

async function renderPdf(html: string): Promise<Uint8Array | null> {
  try {
    const browser = await launchPdfBrowser();
    try {
      const page = await browser.newPage({ locale: "he-IL" });
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });
      return new Uint8Array(pdf);
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (error) {
    console.warn("[reconciliation-export] playwright render failed — HTML fallback", error);
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, READ_PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as
      | { week?: unknown; format?: unknown; rows?: unknown; kpis?: unknown; summary?: unknown }
      | null;
    const week = typeof body?.week === "string" ? body.week.trim() : "";
    const format = body?.format === "excel" ? "excel" : "pdf";
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

    if (format === "excel") {
      const buf = buildWorkbook(data);
      return new Response(new Blob([new Uint8Array(buf)]), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const fontBase64 = await loadHebrewFont();
    const html = buildReconciliationPdfHtml(data, {
      family: "Noto Sans Hebrew",
      mimeType: "font/ttf",
      base64: fontBase64,
    });
    const pdfBytes = await renderPdf(html);

    if (pdfBytes) {
      return new Response(new Blob([new Uint8Array(pdfBytes)]), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${baseName}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${baseName}.html"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[reconciliation-export] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" },
      { status: 500 },
    );
  }
}
