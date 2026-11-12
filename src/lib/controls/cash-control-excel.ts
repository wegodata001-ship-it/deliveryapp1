import * as XLSX from "xlsx";
import type { CashExportData } from "@/app/admin/cash-control/export-data";

function n(s: string | null | undefined): number {
  const v = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
}

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "—";
}

/** חוברת Excel מתוך snapshot שכבר חושב. לא שולפת נתונים חיים. */
export function buildCashControlWorkbook(data: CashExportData): Buffer {
  const wb = XLSX.utils.book_new();

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

  const deviations: (string | number)[][] = [
    ["הזמנה", "תוכנן", "שולם בפועל", "סכום $"],
    ...data.deviations.map((d) => [d.orderNumber ?? "—", d.plannedLabel, d.actualLabel, n(d.amountUsd)]),
  ];
  const wsDev = XLSX.utils.aoa_to_sheet(deviations);
  wsDev["!cols"] = [{ wch: 16 }, { wch: 22 }, { wch: 22 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsDev, "חריגות אמצעי תשלום");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
