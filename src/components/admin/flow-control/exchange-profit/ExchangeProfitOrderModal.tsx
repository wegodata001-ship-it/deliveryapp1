"use client";

import { useEffect, useState } from "react";
import { Eye, FileText, X } from "lucide-react";
import { getExchangeProfitOrderDetailAction } from "@/app/admin/cash-flow/get-exchange-profit-actions";
import type { ExchangeProfitOrderDetailDto } from "@/app/admin/cash-flow/exchange-profit-types";
import { ExchangeProfitTimeline } from "./ExchangeProfitTimeline";
import { ExchangeProfitCalculation } from "./ExchangeProfitCalculation";
import { openPdfPreview } from "@/lib/pdf-preview";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { fcNum } from "@/components/admin/flow-control/shared";

export type ExchangeProfitOrderModalProps = {
  open: boolean;
  week: string;
  orderId: string | null;
  onClose: () => void;
};

function Skeleton() {
  return (
    <div className="xp-skeleton" aria-busy>
      <div className="xp-skeleton__block" />
      <div className="xp-skeleton__block" />
      <div className="xp-skeleton__block xp-skeleton__block--tall" />
    </div>
  );
}

export function ExchangeProfitOrderModal({ open, week, orderId, onClose }: ExchangeProfitOrderModalProps) {
  const [detail, setDetail] = useState<ExchangeProfitOrderDetailDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !orderId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getExchangeProfitOrderDetailAction({ week, orderId }).then((res) => {
      if (cancelled) return;
      if (!res) setError("לא נמצאו פרטי הזמנה");
      setDetail(res);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, week, orderId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="xp-overlay xp-overlay--nested" role="presentation" onClick={onClose}>
      <div
        className="xp-modal xp-modal--order"
        role="dialog"
        aria-modal="true"
        aria-label="פרטי הזמנה — רווח מט״ח"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="xp-modal__head">
          <div>
            <h2>פרטי הזמנה</h2>
            {detail?.orderNumber ? (
              <p className="xp-modal__sub" dir="ltr">
                {detail.orderNumber}
              </p>
            ) : null}
          </div>
          <button type="button" className="xp-iconbtn" onClick={onClose} aria-label="סגור">
            <X size={20} />
          </button>
        </header>

        <div className="xp-modal__body">
          {loading ? <Skeleton /> : null}
          {error ? <p className="xp-error">{error}</p> : null}
          {!loading && detail ? (
            <>
              <section className="xp-meta-cards">
                <article className="xp-card">
                  <span>לקוח</span>
                  <strong>{detail.customerName ?? "—"}</strong>
                </article>
                <article className="xp-card">
                  <span>ספק</span>
                  <strong>{detail.supplierLabel ?? "—"}</strong>
                </article>
                <article className="xp-card">
                  <span>מדינה</span>
                  <strong>{detail.countryLabel ?? "—"}</strong>
                </article>
                <article className="xp-card">
                  <span>סטטוס</span>
                  <strong>{detail.statusLabel}</strong>
                </article>
                <article className="xp-card">
                  <span>פתיחה</span>
                  <strong dir="ltr">{detail.openedAtYmd ?? "—"}</strong>
                </article>
                <article className="xp-card">
                  <span>קבלת כסף</span>
                  <strong dir="ltr">{detail.receivedAtYmd ?? "—"}</strong>
                </article>
                <article className="xp-card">
                  <span>תשלום לספק</span>
                  <strong dir="ltr">{detail.paidAtYmd ?? "—"}</strong>
                </article>
              </section>

              <section className="xp-section">
                <h4>Timeline</h4>
                <ExchangeProfitTimeline events={detail.timeline} />
              </section>

              <section className="xp-section">
                <h4>כספים שהתקבלו</h4>
                {detail.receipts.length === 0 ? (
                  <p className="xp-muted">אין תקבולים</p>
                ) : (
                  <div className="xp-mini-table-wrap">
                    <table className="xp-mini-table">
                      <thead>
                        <tr>
                          <th>תאריך</th>
                          <th>סוג תשלום</th>
                          <th>מטבע</th>
                          <th className="xp-num">סכום</th>
                          <th className="xp-num">שער</th>
                          <th className="xp-num">שווי ₪</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.receipts.map((r) => (
                          <tr key={r.id}>
                            <td dir="ltr">{r.dateYmd}</td>
                            <td>{r.methodLabel}</td>
                            <td>{r.currency === "USD" ? "$" : r.currency === "ILS" ? "₪" : "מעורב"}</td>
                            <td dir="ltr" className="xp-num">
                              {r.currency === "ILS"
                                ? fmtDailyMoney("ILS", fcNum(r.amount))
                                : fmtDailyMoney("USD", fcNum(r.amount))}
                            </td>
                            <td dir="ltr" className="xp-num">
                              {r.rate ?? "—"}
                            </td>
                            <td dir="ltr" className="xp-num">
                              {r.ilsValue ? fmtDailyMoney("ILS", fcNum(r.ilsValue)) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="xp-section">
                <h4>המרות מט״ח</h4>
                {detail.fxConversions.length === 0 ? (
                  <p className="xp-muted">לא בוצעו המרות בשבוע זה</p>
                ) : (
                  <div className="xp-mini-table-wrap">
                    <table className="xp-mini-table">
                      <thead>
                        <tr>
                          <th>תאריך</th>
                          <th>מ-</th>
                          <th>אל</th>
                          <th className="xp-num">שער</th>
                          <th className="xp-num">עמלה</th>
                          <th className="xp-num">סכום $</th>
                          <th className="xp-num">שווי ₪</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.fxConversions.map((fx) => (
                          <tr key={fx.id}>
                            <td dir="ltr">{fx.dateYmd}</td>
                            <td>{fx.fromCurrency}</td>
                            <td>{fx.toCurrency}</td>
                            <td dir="ltr" className="xp-num">
                              {fx.rate}
                            </td>
                            <td dir="ltr" className="xp-num">
                              {fx.commission ?? "—"}
                            </td>
                            <td dir="ltr" className="xp-num">
                              {fmtDailyMoney("USD", fcNum(fx.amount))}
                            </td>
                            <td dir="ltr" className="xp-num">
                              {fmtDailyMoney("ILS", fcNum(fx.ilsValue))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="xp-section">
                <h4>תשלומים לספק</h4>
                <div className="xp-mini-table-wrap">
                  <table className="xp-mini-table">
                    <thead>
                      <tr>
                        <th>תאריך</th>
                        <th>ספק</th>
                        <th>מטבע</th>
                        <th className="xp-num">סכום</th>
                        <th className="xp-num">שער</th>
                        <th className="xp-num">עמלה</th>
                        <th className="xp-num">סה״כ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.supplierPayments.map((sp) => (
                        <tr key={sp.id}>
                          <td dir="ltr">{sp.dateYmd}</td>
                          <td>{sp.supplierLabel}</td>
                          <td>$</td>
                          <td dir="ltr" className="xp-num">
                            {fmtDailyMoney("USD", fcNum(sp.amount))}
                          </td>
                          <td dir="ltr" className="xp-num">
                            {sp.rate ?? "—"}
                          </td>
                          <td dir="ltr" className="xp-num">
                            {sp.commission ? fmtDailyMoney("USD", fcNum(sp.commission)) : "—"}
                          </td>
                          <td dir="ltr" className="xp-num">
                            {fmtDailyMoney("USD", fcNum(sp.total))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <ExchangeProfitCalculation calc={detail.calculation} />

              <section className="xp-section">
                <h4>מסמכים</h4>
                {detail.documents.length === 0 ? (
                  <p className="xp-muted">אין מסמכים מצורפים</p>
                ) : (
                  <div className="xp-docs">
                    {detail.documents.map((doc) => (
                      <article key={doc.id} className="xp-doc-card">
                        <FileText size={18} aria-hidden />
                        <div>
                          <strong>{doc.fileName}</strong>
                          <span className="xp-muted">
                            {doc.docTypeLabel} · {doc.entityType}
                          </span>
                        </div>
                        {doc.previewable ? (
                          <button
                            type="button"
                            className="xp-iconbtn"
                            title="צפייה"
                            onClick={() => {
                              void (async () => {
                                try {
                                  const res = await fetch(`/api/documents/${doc.id}/download`);
                                  if (!res.ok) throw new Error("fail");
                                  // redirect → follow; if JSON error, open blank
                                  const blob = await res.blob();
                                  if (blob.type.includes("json")) {
                                    window.open(`/api/documents/${doc.id}/download`, "_blank", "noopener");
                                    return;
                                  }
                                  openPdfPreview({
                                    blob,
                                    filename: doc.fileName,
                                    mime: blob.type || "application/pdf",
                                  });
                                } catch {
                                  window.open(`/api/documents/${doc.id}/download`, "_blank", "noopener");
                                }
                              })();
                            }}
                          >
                            <Eye size={16} />
                          </button>
                        ) : (
                          <a
                            className="xp-iconbtn"
                            href={`/api/documents/${doc.id}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="הורדה"
                          >
                            <Eye size={16} />
                          </a>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default ExchangeProfitOrderModal;
