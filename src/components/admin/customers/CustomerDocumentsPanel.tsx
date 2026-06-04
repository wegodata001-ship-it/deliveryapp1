"use client";

import { useState } from "react";
import { getCustomerLedgerAction } from "@/app/admin/capture/actions";
import {
  exportCustomerLedgerExcel,
  exportCustomerLedgerPdf,
  ledgerHasExportRows,
  type CustomerLedgerExportMeta,
} from "@/lib/customer-ledger-export";
import type { CustomerProfileOrderRow, CustomerProfilePaymentRow } from "@/lib/customers-module-types";
import {
  exportCustomerModuleOrdersExcel,
  exportCustomerModuleOrdersPdf,
  exportCustomerModulePaymentsExcel,
  exportCustomerModulePaymentsPdf,
} from "@/lib/customers-module-export";

export type CustomerModuleExportKind = "ledger" | "orders" | "payments" | "open";

const REPORT_OPTIONS: { value: CustomerModuleExportKind; label: string }[] = [
  { value: "ledger", label: "כרטסת לקוח" },
  { value: "orders", label: "דוח הזמנות" },
  { value: "payments", label: "דוח תשלומים" },
  { value: "open", label: "יתרות פתוחות" },
];

function filterByDate<T>(rows: T[], fromYmd: string, toYmd: string, getYmd: (r: T) => string): T[] {
  const from = fromYmd.trim();
  const to = toYmd.trim();
  if (!from && !to) return rows;
  return rows.filter((r) => {
    const d = getYmd(r);
    if (d === "—") return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

type Props = {
  onToast: (msg: string) => void;
  customerId: string | null;
  exportMeta: CustomerLedgerExportMeta;
  /** TURKEY | CHINA — סינון כרטסת/PDF לפי מדינת עבודה */
  ledgerSourceCountry?: string | null;
  orders: CustomerProfileOrderRow[];
  payments: CustomerProfilePaymentRow[];
  /** תצוגה קומפקטית בראש מסך ה-Workspace */
  compact?: boolean;
};

export function CustomerDocumentsPanel({
  onToast,
  customerId,
  exportMeta,
  ledgerSourceCountry = null,
  orders,
  payments,
  compact = false,
}: Props) {
  const [fromYmd, setFromYmd] = useState("");
  const [toYmd, setToYmd] = useState("");
  const [reportType, setReportType] = useState<CustomerModuleExportKind>("ledger");
  const [busy, setBusy] = useState<"pdf" | "excel" | "email" | null>(null);

  const meta: CustomerLedgerExportMeta = { ...exportMeta, fromYmd, toYmd };

  async function runExport(format: "pdf" | "excel") {
    if (busy) return;
    setBusy(format);
    onToast(format === "pdf" ? "מייצא PDF…" : "מייצא Excel…");
    try {
      if (reportType === "ledger" || reportType === "open") {
        if (!customerId) {
          onToast("בחרו לקוח לייצוא כרטסת / יתרות פתוחות");
          return;
        }
        const ledger = await getCustomerLedgerAction({
          customerId,
          fromYmd: fromYmd || undefined,
          toYmd: toYmd || undefined,
          sourceCountry: ledgerSourceCountry ?? meta.sourceCountry ?? undefined,
        });
        if (!ledgerHasExportRows(ledger)) {
          onToast("אין נתונים לייצוא");
          return;
        }
        const ledgerExportMeta: CustomerLedgerExportMeta =
          reportType === "ledger"
            ? meta
            : { ...meta, displayName: `${meta.displayName} · יתרות פתוחות` };
        if (format === "pdf") await exportCustomerLedgerPdf(ledgerExportMeta, ledger!);
        else await exportCustomerLedgerExcel(ledgerExportMeta, ledger!);
        onToast(format === "pdf" ? "PDF הורד בהצלחה" : "Excel הורד בהצלחה");
        return;
      }

      if (reportType === "orders") {
        const rows = filterByDate(orders, fromYmd, toYmd, (r) => r.dateYmd);
        if (!rows.length) {
          onToast("אין הזמנות בטווח");
          return;
        }
        if (format === "pdf") await exportCustomerModuleOrdersPdf(meta, rows);
        else await exportCustomerModuleOrdersExcel(meta, rows);
        onToast(format === "pdf" ? "PDF הורד בהצלחה" : "Excel הורד בהצלחה");
        return;
      }

      if (reportType === "payments") {
        const rows = filterByDate(payments, fromYmd, toYmd, (r) => r.dateYmd);
        if (!rows.length) {
          onToast("אין תשלומים בטווח");
          return;
        }
        let ledgerForPdf = null;
        if (format === "pdf" && customerId) {
          ledgerForPdf = await getCustomerLedgerAction({
            customerId,
            fromYmd: fromYmd || undefined,
            toYmd: toYmd || undefined,
            sourceCountry: ledgerSourceCountry ?? meta.sourceCountry ?? undefined,
          });
        }
        if (format === "pdf") await exportCustomerModulePaymentsPdf(meta, rows, ledgerForPdf);
        else await exportCustomerModulePaymentsExcel(meta, rows);
        onToast(format === "pdf" ? "PDF הורד בהצלחה" : "Excel הורד בהצלחה");
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : "ייצוא נכשל");
    } finally {
      setBusy(null);
    }
  }

  function onEmail() {
    if (busy) return;
    setBusy("email");
    onToast("שליחת דוח במייל — בקרוב");
    window.setTimeout(() => setBusy(null), 1200);
  }

  return (
    <div className={compact ? "adm-cust-docs-card adm-cust-docs-card--compact" : "adm-cust-docs-card"}>
      {!compact ? <h3 className="adm-cust-docs-card__title">הפקת מסמכים</h3> : null}
      <div className="adm-cust-docs-card__form">
        <div className="adm-field adm-field--wide">
          <label htmlFor="cust-docs-type">סוג מסמך</label>
          <select
            id="cust-docs-type"
            value={reportType}
            onChange={(e) => setReportType(e.target.value as CustomerModuleExportKind)}
          >
            {REPORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="adm-field">
          <label htmlFor="cust-docs-from">מתאריך</label>
          <input id="cust-docs-from" type="date" value={fromYmd} onChange={(e) => setFromYmd(e.target.value)} />
        </div>
        <div className="adm-field">
          <label htmlFor="cust-docs-to">עד תאריך</label>
          <input id="cust-docs-to" type="date" value={toYmd} onChange={(e) => setToYmd(e.target.value)} />
        </div>
      </div>
      <div className="adm-cust-docs-card__actions">
        <button
          type="button"
          className="adm-btn adm-btn--primary adm-export-btn--pdf"
          disabled={!!busy}
          onClick={() => void runExport("pdf")}
        >
          {busy === "pdf" ? "מייצא…" : "PDF"}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--secondary adm-export-btn--excel"
          disabled={!!busy}
          onClick={() => void runExport("excel")}
        >
          {busy === "excel" ? "מייצא…" : "Excel"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost" disabled={!!busy} onClick={onEmail}>
          שלח למייל
        </button>
      </div>
    </div>
  );
}
