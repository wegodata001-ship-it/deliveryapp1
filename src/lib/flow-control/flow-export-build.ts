import * as XLSX from "xlsx";
import type { FlowExportData } from "@/app/admin/cash-flow/flow-export-data";
import { CASH_WEEK_FLOW_LINE_IDS } from "@/lib/cash-control-week-flow";

function n(v: string | number | null | undefined): number {
  const x = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(x) ? x : 0;
}

export function buildFlowExportWorkbook(data: FlowExportData): Buffer {
  const wb = XLSX.utils.book_new();
  const ov = data.overview;
  const f = data.flow;

  const summary: (string | number)[][] = [
    ["WEGO DELIVER — בקרת תזרים"],
    ["שבוע", data.week],
    ["טווח", `${data.rangeFrom ?? "—"} – ${data.rangeTo ?? "—"}`],
    ["הפקה", data.generatedAt.slice(0, 19)],
    [],
    ["הזמנות בשבוע", ov?.totalOrders ?? 0],
    ["סך הזמנות $", ov?.totalOrdersUsd ?? "0"],
    ["נותר לתשלום $ (שבוע)", ov?.remainingToPayUsd ?? "0"],
    ["תשלומים לפי קליטה", f.weekContext.paymentsReceivedInWeek],
    ["תשלומים לפי weekCode", f.weekContext.paymentsByWeekCodeOnly],
    ["נקלט ₪ (קליטה)", f.kpis.totalReceivedIls],
    [],
    [
      "יתרת פתיחה $",
      f.cashboxes.usd.openingVerified && f.cashboxes.usd.opening != null
        ? f.cashboxes.usd.opening
        : f.cashboxes.openingMessageHe,
    ],
    [
      "יתרת פתיחה ₪",
      f.cashboxes.ils.openingVerified && f.cashboxes.ils.opening != null
        ? f.cashboxes.ils.opening
        : f.cashboxes.openingMessageHe,
    ],
    ["קופת $ — יתרה", f.drawerRemainingUsd ?? "טרם ספירה"],
    ["קופת ₪ — ייתרה", f.drawerRemainingIls ?? "טרם ספירה"],
    ["טורקיה — יתרה $", f.turkeyBalanceClosingUsd],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "סיכום");

  const receipts: (string | number)[][] = [
    ["שורה", "תקבול בפועל", "ספירה יומית", "הפרש ספירה"],
    ...CASH_WEEK_FLOW_LINE_IDS.map((id) => [
      id,
      n(f.receiptLayers.actualReceipts[id].amount),
      n(f.receiptLayers.dailyApproved[id].amount),
      f.countDiff[id] != null ? n(f.countDiff[id]) : "—",
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(receipts), "תקבולים");

  const fxRows: (string | number)[][] = [
    ["מסלול", "₪", "$", "שער"],
    ...f.fxPurchases.map((p) => [
      p.track ?? "PS",
      p.ilsAmount,
      p.usdReceived,
      p.rate,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fxRows), "מטח");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function buildFlowExportPdfHtml(data: FlowExportData): string {
  const f = data.flow;
  const ov = data.overview;
  const rows = CASH_WEEK_FLOW_LINE_IDS.map(
    (id) =>
      `<tr><td>${id}</td><td>${f.receiptLayers.actualReceipts[id].amount}</td><td>${f.receiptLayers.dailyApproved[id].amount}</td><td>${f.countDiff[id] ?? "—"}</td></tr>`,
  ).join("");
  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"/>
<style>body{font-family:Arial,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px}h1{font-size:18px}</style>
</head><body>
<h1>WEGO DELIVER — בקרת תזרים</h1>
<p>שבוע: ${data.week} · ${data.rangeFrom ?? ""} – ${data.rangeTo ?? ""}</p>
<p>הזמנות: ${ov?.totalOrders ?? 0} · $${ov?.totalOrdersUsd ?? "0"} · נקלט ₪ ${f.kpis.totalReceivedIls}</p>
<p>תשלומים (קליטה / weekCode): ${f.weekContext.paymentsReceivedInWeek} / ${f.weekContext.paymentsByWeekCodeOnly}</p>
<table><thead><tr><th>שורה</th><th>תקבול</th><th>יומי</th><th>הפרש</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
}
