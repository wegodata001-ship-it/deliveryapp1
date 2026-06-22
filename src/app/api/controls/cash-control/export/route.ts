import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { launchPdfBrowser } from "@/lib/playwright-pdf-browser";
import { buildCashControlPdfHtml } from "@/lib/controls/cash-control-pdf-html";
import { getCashExportData, type CashExportData } from "@/app/admin/cash-control/export-data";

const READ_PERMS = ["view_payment_control"];

function n(s: string | null | undefined): number {
  const v = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
}

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "—";
}

async function loadHebrewFont(): Promise<string> {
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansHebrew-Regular.ttf");
  const bytes = await readFile(fontPath);
  return bytes.toString("base64");
}

function buildWorkbook(data: CashExportData): Buffer {
  const wb = XLSX.utils.book_new();

  // 1) סיכום
  const summary: (string | number)[][] = [
    ["WEGO — בקרת קופה"],
    ["שבוע עבודה", data.week],
    ["טווח", `${ymd(data.rangeFrom)} – ${ymd(data.rangeTo)}`],
    ["תאריך הפקה", ymd(data.generatedAt)],
    [],
    ["מטבע", "קליטות מזומן", "הוצאות קופה", "צפוי בקופה", "נספר בפועל", "פער"],
    [
      "ש״ח (ILS)",
      n(data.totals.receiptsIls),
      n(data.totals.expensesIls),
      n(data.totals.expectedIls),
      data.counted.ils != null ? n(data.counted.ils) : "—",
      data.counted.diffIls != null ? n(data.counted.diffIls) : "—",
    ],
    [
      "דולר (USD)",
      n(data.totals.receiptsUsd),
      n(data.totals.expensesUsd),
      n(data.totals.expectedUsd),
      data.counted.usd != null ? n(data.counted.usd) : "—",
      data.counted.diffUsd != null ? n(data.counted.diffUsd) : "—",
    ],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summary);
  wsSummary["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, "סיכום");

  // 2) תנועות יומיות
  const daily: (string | number)[][] = [
    ["תאריך", "קליטות ₪", "הוצאות ₪", "צפוי ₪", "קליטות $", "הוצאות $", "צפוי $"],
    ...data.days.map((d) => [
      ymd(d.date),
      n(d.receiptsIls),
      n(d.expensesIls),
      n(d.expectedIls),
      n(d.receiptsUsd),
      n(d.expensesUsd),
      n(d.expectedUsd),
    ]),
    [
      "סה״כ",
      n(data.totals.receiptsIls),
      n(data.totals.expensesIls),
      n(data.totals.expectedIls),
      n(data.totals.receiptsUsd),
      n(data.totals.expensesUsd),
      n(data.totals.expectedUsd),
    ],
  ];
  const wsDaily = XLSX.utils.aoa_to_sheet(daily);
  wsDaily["!cols"] = [{ wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }];
  XLSX.utils.book_append_sheet(wb, wsDaily, "תנועות יומיות");

  // 3) הוצאות קופה
  const expenses: (string | number)[][] = [
    ["תאריך", "מטבע", "סכום", "סיבה", "הערות", "נרשם ע״י"],
    ...data.expenses.map((e) => [
      ymd(e.date),
      e.currency === "ILS" ? "₪" : "$",
      n(e.amount),
      e.reasonLabel,
      e.notes ?? "—",
      e.createdByName ?? "—",
    ]),
  ];
  const wsExpenses = XLSX.utils.aoa_to_sheet(expenses);
  wsExpenses["!cols"] = [{ wch: 12 }, { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 24 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsExpenses, "הוצאות קופה");

  // 4) Audit
  const audit: (string | number)[][] = [
    ["תאריך", "ש״ח מערכת", "ש״ח בפועל", "פער ₪", "דולר מערכת", "דולר בפועל", "פער $", "סטטוס", "משתמש", "הערה"],
    ...data.counts.map((c) => [
      ymd(c.countedAt),
      n(c.expectedIls),
      n(c.countedIls),
      n(c.diffIls),
      n(c.expectedUsd),
      n(c.countedUsd),
      n(c.diffUsd),
      c.status === "APPROVED" ? "אושר" : "פתוח",
      c.createdByName ?? "—",
      c.varianceNote ?? "—",
    ]),
  ];
  const wsAudit = XLSX.utils.aoa_to_sheet(audit);
  wsAudit["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAudit, "Audit");

  // 5) חריגות אמצעי תשלום
  const deviations: (string | number)[][] = [
    ["הזמנה", "תוכנן", "שולם בפועל", "סכום $"],
    ...data.deviations.map((d) => [d.orderNumber ?? "—", d.plannedLabel, d.actualLabel, n(d.amountUsd)]),
  ];
  const wsDev = XLSX.utils.aoa_to_sheet(deviations);
  wsDev["!cols"] = [{ wch: 16 }, { wch: 22 }, { wch: 22 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsDev, "חריגות אמצעי תשלום");

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
    console.warn("[cash-control-export] playwright render failed — HTML fallback", error);
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const me = await requireAuth();
    if (!userHasAnyPermission(me, READ_PERMS)) {
      return NextResponse.json({ ok: false, error: "אין הרשאה" }, { status: 403 });
    }

    const body = (await req.json().catch(() => null)) as { week?: unknown; format?: unknown } | null;
    const week = typeof body?.week === "string" ? body.week.trim() : "";
    const format = body?.format === "excel" ? "excel" : "pdf";
    if (!week) {
      return NextResponse.json({ ok: false, error: "שבוע חסר" }, { status: 400 });
    }

    const data = await getCashExportData(week);
    const baseName = `Cash_Control_${week.replace(/[^\w-]/g, "_")}`;

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
    const html = buildCashControlPdfHtml(data, {
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
        "X-Cash-Pdf-Fallback": "html",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[cash-control-export] failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ייצוא נכשל" },
      { status: 500 },
    );
  }
}
