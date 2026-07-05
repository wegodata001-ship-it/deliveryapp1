"use client";

import { ExternalLink, FileText, Inbox } from "lucide-react";
import type { CashDetailPayload, CashDetailRow } from "@/app/admin/cash-control/actions";
import type { CashCurrency } from "@/app/admin/cash-control/constants";
import type { PaymentBucketKey } from "@/lib/payment-breakdown-shared";

export type CashDetailsVariant = "all" | "receipts" | "expenses";

function num(s: string | null | undefined): number {
  const n = Number((s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function ils(s: string | null | undefined): string {
  return `₪ ${num(s).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function usd(s: string | null | undefined): string {
  return `$ ${num(s).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function money(currency: CashCurrency, s: string | null | undefined): string {
  return currency === "ILS" ? ils(s) : usd(s);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const CASH_METHOD_TAG_CLASS: Record<PaymentBucketKey, string> = {
  CASH: "adm-cash-mtag--cash",
  BANK_TRANSFER: "adm-cash-mtag--bank",
  CREDIT: "adm-cash-mtag--credit",
  CHECK: "adm-cash-mtag--check",
  OTHER: "adm-cash-mtag--other",
};

export function CashMethodTag({ row }: { row: CashDetailRow }) {
  if (row.kind === "EXPENSE") {
    return <span className="adm-cash-mtag adm-cash-mtag--other">{row.reasonLabel ?? "הוצאה"}</span>;
  }
  const cls = row.methodBucket ? CASH_METHOD_TAG_CLASS[row.methodBucket] : "adm-cash-mtag--other";
  return <span className={`adm-cash-mtag ${cls}`}>{row.methodLabel ?? "מזומן"}</span>;
}

function footerLabel(variant: CashDetailsVariant, currency: CashCurrency): string {
  const cur = currency === "ILS" ? "₪" : "דולר";
  if (variant === "expenses") return `סה״כ הוצאות ${cur}`;
  if (variant === "receipts") return `סה״כ התקבל ${cur}`;
  return `סה״כ קופת ${cur}`;
}

function summaryTotalLabel(variant: CashDetailsVariant, currency: CashCurrency): string {
  const cur = currency === "ILS" ? "₪" : "דולר";
  if (variant === "expenses") return `סכום הוצאות (${cur})`;
  if (variant === "receipts") return `סכום התקבל (${cur})`;
  return `סכום כולל (${cur})`;
}

function summaryAmount(variant: CashDetailsVariant, currency: CashCurrency, payload: CashDetailPayload): string {
  if (variant === "expenses") return money(currency, payload.expenses);
  if (variant === "receipts") return money(currency, payload.receipts);
  return money(currency, payload.total);
}

function footerAmount(variant: CashDetailsVariant, currency: CashCurrency, payload: CashDetailPayload): string {
  if (variant === "expenses") return money(currency, `-${payload.expenses}`);
  if (variant === "receipts") return money(currency, payload.receipts);
  return money(currency, payload.total);
}

function footerTone(variant: CashDetailsVariant): string {
  if (variant === "expenses") return "adm-cash-details__foot-val--neg";
  if (variant === "receipts") return "adm-cash-details__foot-val--pos";
  return "adm-cash-details__foot-val--total";
}

const TABLE_HEAD = (
  <thead>
    <tr>
      <th className="adm-cash-dcol-date">תאריך</th>
      <th className="adm-cash-dcol-ref">אסמכתא</th>
      <th className="adm-cash-dcol-doc">קליטת תשלום</th>
      <th className="adm-cash-dcol-cust">לקוח</th>
      <th className="adm-cash-dcol-usd">דולר</th>
      <th className="adm-cash-dcol-ils">₪</th>
      <th className="adm-cash-dcol-method">אמצעי תשלום</th>
      <th className="adm-cash-dcol-user">משתמש</th>
      <th className="adm-cash-dcol-act" aria-label="פעולות">
        פעולות
      </th>
    </tr>
  </thead>
);

function DetailRow({ row, onRowClick }: { row: CashDetailRow; onRowClick: (row: CashDetailRow) => void }) {
  const isExpense = row.kind === "EXPENSE";
  const amtCls = isExpense ? "adm-cash-cell--neg" : "adm-cash-cell--pos";
  return (
    <tr
      className="adm-cash-details__row adm-cash-row-link"
      onClick={() => onRowClick(row)}
      title={isExpense ? "פרטי הוצאת קופה" : "פרטי קליטת תשלום"}
    >
      <td className="adm-cash-dcol-date" dir="ltr">
        {fmtDate(row.date)}
      </td>
      <td className="adm-cash-dcol-ref" dir="ltr">
        {row.orderNumber ?? "—"}
      </td>
      <td className="adm-cash-dcol-doc" dir="ltr">
        {row.docLabel ?? "—"}
      </td>
      <td className="adm-cash-dcol-cust">{row.customerName ?? (isExpense ? row.movementLabel : "—")}</td>
      <td className={`adm-cash-dcol-usd adm-cash-details__num ${amtCls}`} dir="ltr">
        {row.amountUsd ? usd(row.amountUsd) : "—"}
      </td>
      <td className={`adm-cash-dcol-ils adm-cash-details__num ${amtCls}`} dir="ltr">
        {row.amountIls ? ils(row.amountIls) : "—"}
      </td>
      <td className="adm-cash-dcol-method">
        <CashMethodTag row={row} />
      </td>
      <td className="adm-cash-dcol-user">{row.userName ?? "—"}</td>
      <td className="adm-cash-dcol-act adm-cash-details__act">
        {row.documents.length > 0 ? (
          <span className="adm-cash-doc-badge" title={`${row.documents.length} מסמכים מצורפים`}>
            <FileText size={13} aria-hidden /> {row.documents.length}
          </span>
        ) : (
          <ExternalLink size={14} aria-hidden />
        )}
      </td>
    </tr>
  );
}

export function CashDetailsTable({
  variant,
  currency,
  rows,
  payload,
  onRowClick,
}: {
  variant: CashDetailsVariant;
  currency: CashCurrency;
  rows: CashDetailRow[];
  payload: CashDetailPayload;
  onRowClick: (row: CashDetailRow) => void;
}) {
  const movementCount = rows.length;
  const lastUser =
    [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]?.userName ?? "—";
  const totalLabel = summaryTotalLabel(variant, currency);
  const totalVal = movementCount > 0 ? summaryAmount(variant, currency, payload) : money(currency, "0");
  const footLabel = footerLabel(variant, currency);
  const footVal = movementCount > 0 ? footerAmount(variant, currency, payload) : money(currency, "0");
  const footTone = footerTone(variant);

  return (
    <div className="adm-cash-details">
      <div className="adm-cash-details__summary" role="region" aria-label="סיכום">
        <div className="adm-cash-details__card">
          <span className="adm-cash-details__card-lbl">{totalLabel}</span>
          <strong className="adm-cash-details__card-val" dir="ltr">
            {totalVal}
          </strong>
        </div>
        <div className="adm-cash-details__card">
          <span className="adm-cash-details__card-lbl">מספר תנועות</span>
          <strong className="adm-cash-details__card-val">{movementCount}</strong>
        </div>
        <div className="adm-cash-details__card">
          <span className="adm-cash-details__card-lbl">משתמש קולט אחרון</span>
          <strong className="adm-cash-details__card-val adm-cash-details__card-val--txt">{lastUser}</strong>
        </div>
      </div>

      <div className="adm-cash-details__table-shell">
        {rows.length > 0 ? (
          <div className="adm-cash-details__thead-wrap">
            <table className="adm-cash-details__table adm-cash-details__table--head adm-cash-erp-table">{TABLE_HEAD}</table>
          </div>
        ) : (
          <div className="adm-cash-details__empty" role="status">
            <Inbox size={28} strokeWidth={1.5} aria-hidden />
            <p>אין תנועות להצגה.</p>
          </div>
        )}
        {rows.length > 0 ? (
          <div className="adm-cash-details__scroll">
            <table className="adm-cash-details__table adm-cash-details__table--body adm-cash-erp-table">
              <tbody>
                {rows.map((r) => (
                  <DetailRow key={`${r.kind}:${r.id}`} row={r} onRowClick={onRowClick} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="adm-cash-details__tfoot-wrap">
          <table className="adm-cash-details__table adm-cash-details__table--foot adm-cash-erp-table">
            <tfoot>
              <tr>
                <td colSpan={4} className="adm-cash-details__foot-lbl">
                  {footLabel}
                </td>
                <td
                  className={`adm-cash-dcol-usd adm-cash-details__num adm-cash-details__foot-val ${footTone}`}
                  dir="ltr"
                >
                  {currency === "USD" ? footVal : "—"}
                </td>
                <td
                  className={`adm-cash-dcol-ils adm-cash-details__num adm-cash-details__foot-val ${footTone}`}
                  dir="ltr"
                >
                  {currency === "ILS" ? footVal : "—"}
                </td>
                <td colSpan={3} className="adm-cash-details__foot-pad" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
