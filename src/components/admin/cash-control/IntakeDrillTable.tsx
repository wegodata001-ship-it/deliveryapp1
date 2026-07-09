"use client";

import { useCallback, useState } from "react";
import { Check, ExternalLink, Eye, Loader2 } from "lucide-react";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import { openPaymentDocumentPreview } from "@/lib/open-payment-document-preview";
import { num } from "@/components/admin/cash-flow/shared";

export type IntakeDrillTableProps = {
  currency: "ILS" | "USD";
  loading: boolean;
  rows: CashDailyMethodDetailRow[] | null;
  reviewBusy: string | null;
  onOpenPayment: (paymentId: string) => void;
  onToggleReviewed: (paymentId: string, reviewed: boolean) => void;
};

export function IntakeDrillTable({
  currency,
  loading,
  rows,
  reviewBusy,
  onOpenPayment,
  onToggleReviewed,
}: IntakeDrillTableProps) {
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const handlePreview = useCallback(async (row: CashDailyMethodDetailRow) => {
    if (!row.documentPreviewable) return;
    setPreviewError(null);
    setPreviewBusy(row.paymentId);
    try {
      const res = await openPaymentDocumentPreview({
        paymentId: row.paymentId,
        documentId: row.previewDocumentId,
      });
      if (!res.ok) setPreviewError(res.error ?? "תצוגה מקדימה נכשלה");
    } finally {
      setPreviewBusy(null);
    }
  }, []);

  if (loading) return <p className="cc-loading">טוען…</p>;
  if (!rows || rows.length === 0) return <p className="cc-empty">אין קליטות</p>;

  return (
    <div className="cc-intake-drill">
      {previewError ? (
        <p className="cc-intake-drill__err" role="alert">
          {previewError}
        </p>
      ) : null}
      <div className="cc-block__scroll">
        <table className="cc-table cc-table--detail cc-intake-drill__table">
          <thead>
            <tr>
              <th>שעה</th>
              <th>לקוח</th>
              <th>עובד</th>
              <th>מספר קליטה</th>
              <th className="cc-num">סכום</th>
              <th className="cc-intake-drill__col-check">נבדק</th>
              <th className="cc-intake-drill__col-actions">צפייה</th>
              <th className="cc-intake-drill__col-actions">פתח קליטה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const previewDisabled = !r.documentPreviewable;
              const previewLoading = previewBusy === r.paymentId;
              return (
                <tr
                  key={r.paymentId}
                  className={`cc-intake-drill__row${r.reviewed ? " is-reviewed" : ""}`}
                >
                  <td dir="ltr">{r.timeHm}</td>
                  <td>{r.customerName ?? "—"}</td>
                  <td>{r.recordedByName ?? "—"}</td>
                  <td dir="ltr">{r.paymentCode ?? "—"}</td>
                  <td dir="ltr" className="cc-num">
                    {fmtDailyMoney(currency, num(r.amount))}
                  </td>
                  <td className="cc-intake-drill__col-check">
                    <label className="cc-intake-drill__check" title="סמן כנבדק">
                      <input
                        type="checkbox"
                        checked={r.reviewed}
                        disabled={reviewBusy === r.paymentId}
                        onChange={(ev) => onToggleReviewed(r.paymentId, ev.target.checked)}
                        aria-label={`נבדק — ${r.paymentCode ?? r.paymentId}`}
                      />
                      <Check
                        size={15}
                        className={r.reviewed ? "cc-intake-drill__check-on" : "cc-intake-drill__check-off"}
                        aria-hidden
                      />
                      <span className="cc-intake-drill__check-lbl">נבדק</span>
                    </label>
                  </td>
                  <td className="cc-intake-drill__col-actions">
                    <button
                      type="button"
                      className={[
                        "cc-intake-drill__iconbtn",
                        previewDisabled ? "is-disabled" : "is-preview",
                      ].join(" ")}
                      title={
                        previewDisabled
                          ? r.hasDocument
                            ? "הקובץ אינו נתמך לתצוגה"
                            : "אין קובץ מצורף"
                          : "תצוגה מקדימה"
                      }
                      aria-label="תצוגה מקדימה"
                      disabled={previewDisabled || previewLoading}
                      onClick={() => void handlePreview(r)}
                    >
                      {previewLoading ? (
                        <Loader2 size={15} className="cc-intake-drill__spin" aria-hidden />
                      ) : (
                        <Eye size={15} aria-hidden />
                      )}
                    </button>
                  </td>
                  <td className="cc-intake-drill__col-actions">
                    <button
                      type="button"
                      className="cc-intake-drill__iconbtn is-open"
                      title="פתח קליטת תשלום"
                      aria-label="פתח קליטת תשלום"
                      onClick={() => onOpenPayment(r.paymentId)}
                    >
                      <ExternalLink size={15} aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default IntakeDrillTable;
