"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, X } from "lucide-react";
import {
  getPaymentDetailViewAction,
  type PaymentDetailViewPayload,
} from "@/app/admin/cash-control/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

function fmtDateShort(ymd: string): string {
  if (!ymd || ymd === "—") return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y.slice(2)}`;
}

function statusLabel(status: PaymentDetailViewPayload["status"]): string {
  if (status === "CANCELLED") return "מבוטל";
  return "פעיל";
}

export function PaymentDetailViewModal({
  paymentId,
  onClose,
}: {
  paymentId: string;
  onClose: () => void;
}) {
  const { openWindow } = useAdminWindows();
  const [payload, setPayload] = useState<PaymentDetailViewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getPaymentDetailViewAction(paymentId).then((data) => {
      if (cancelled) return;
      if (!data) {
        setError("לא ניתן לטעון את פרטי הקליטה");
        setPayload(null);
      } else {
        setPayload(data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  function openPaymentIntake() {
    onClose();
    openWindow({ type: "paymentsUpdated", props: { paymentId } });
  }

  function openOrder() {
    if (!payload?.orderId) return;
    onClose();
    openWindow({
      type: "orderCapture",
      props: { mode: "edit", orderId: payload.orderId, orderNumber: payload.orderNumber },
    });
  }

  return (
    <div className="payment-detail-backdrop" role="presentation" onClick={onClose}>
      <div
        className="payment-detail-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="payment-detail-head">
          <h3 id="payment-detail-title">פרטי קליטת תשלום</h3>
          <button type="button" className="payment-detail-x" onClick={onClose} aria-label="סגור">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="payment-detail-loading">טוען פרטים…</div>
        ) : error || !payload ? (
          <div className="payment-detail-loading">{error ?? "שגיאה בטעינה"}</div>
        ) : (
          <>
            <div className="payment-detail-meta">
              <div className="payment-detail-meta__cell">
                <span className="payment-detail-meta__lbl">מספר קליטת תשלום</span>
                <strong dir="ltr">{payload.paymentCode ?? "—"}</strong>
              </div>
              <div className="payment-detail-meta__cell">
                <span className="payment-detail-meta__lbl">הזמנה</span>
                <strong dir="ltr">{payload.orderNumber ?? "—"}</strong>
              </div>
              <div className="payment-detail-meta__cell">
                <span className="payment-detail-meta__lbl">לקוח</span>
                <strong>{payload.customerName}</strong>
              </div>
              <div className="payment-detail-meta__cell">
                <span className="payment-detail-meta__lbl">עובד שקלט</span>
                <strong>{payload.recordedByName ?? "—"}</strong>
              </div>
              <div className="payment-detail-meta__cell">
                <span className="payment-detail-meta__lbl">תאריך</span>
                <strong dir="ltr">{fmtDateShort(payload.paymentDateYmd)}</strong>
              </div>
              <div className="payment-detail-meta__cell">
                <span className="payment-detail-meta__lbl">שעה</span>
                <strong dir="ltr">{payload.paymentTimeHm}</strong>
              </div>
            </div>

            <div className="payment-detail-table-wrap">
              <table className="payment-detail-tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>אמצעי ($)</th>
                    <th>סכום $</th>
                    <th>הערה ($)</th>
                    <th>אמצעי (₪)</th>
                    <th>סכום ₪</th>
                    <th>הערה (₪)</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="payment-detail-empty">
                        אין שורות פירוט
                      </td>
                    </tr>
                  ) : (
                    payload.lines.map((line) => (
                      <tr key={line.lineNo}>
                        <td>{line.lineNo}</td>
                        <td>{line.usdMethodLabel}</td>
                        <td dir="ltr" className="payment-detail-num">
                          {line.usdAmount !== "—" ? `$${line.usdAmount}` : "—"}
                        </td>
                        <td>{line.usdNote}</td>
                        <td>{line.ilsMethodLabel}</td>
                        <td dir="ltr" className="payment-detail-num">
                          {line.ilsAmount !== "—" ? `₪${line.ilsAmount}` : "—"}
                        </td>
                        <td>{line.ilsNote}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {payload.lines.length > 0 ? (
                  <tfoot>
                    <tr>
                      <td colSpan={2}>סה״כ</td>
                      <td dir="ltr" className="payment-detail-num payment-detail-strong">
                        ${payload.totalUsd}
                      </td>
                      <td />
                      <td />
                      <td dir="ltr" className="payment-detail-num payment-detail-strong">
                        ₪{payload.totalIls}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>

            <div className="payment-detail-extra">
              <div className="payment-detail-extra__grid">
                <div>
                  <span className="payment-detail-meta__lbl">שער</span>
                  <span dir="ltr">{payload.dollarRate ?? "—"}</span>
                </div>
                <div>
                  <span className="payment-detail-meta__lbl">אחוז עמלה</span>
                  <span dir="ltr">{payload.commissionPercent}%</span>
                </div>
                <div>
                  <span className="payment-detail-meta__lbl">סטטוס</span>
                  <span>{statusLabel(payload.status)}</span>
                </div>
                {payload.cancelReason ? (
                  <div className="payment-detail-extra__wide">
                    <span className="payment-detail-meta__lbl">סיבת ביטול</span>
                    <span>{payload.cancelReason}</span>
                  </div>
                ) : null}
                {payload.notes ? (
                  <div className="payment-detail-extra__wide">
                    <span className="payment-detail-meta__lbl">הערות</span>
                    <span>{payload.notes}</span>
                  </div>
                ) : null}
              </div>

              {payload.documents.length > 0 ? (
                <div className="payment-detail-docs">
                  <span className="payment-detail-meta__lbl">מסמכים מצורפים</span>
                  <div className="payment-detail-docs__list">
                    {payload.documents.map((d) => (
                      <a
                        key={d.id}
                        className="payment-detail-doc"
                        href={`/api/documents/${d.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FileText size={14} aria-hidden /> {d.fileName}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="payment-detail-audit">
              <div className="payment-detail-audit__cell">
                <span>נוצר ע״י</span>
                <strong>{payload.createdByName ?? "—"}</strong>
              </div>
              <div className="payment-detail-audit__cell">
                <span>תאריך</span>
                <strong dir="ltr">{fmtDateShort(payload.createdDateYmd)}</strong>
              </div>
              <div className="payment-detail-audit__cell">
                <span>שעת יצירה</span>
                <strong dir="ltr">{payload.createdTimeHm}</strong>
              </div>
              {payload.wasUpdated ? (
                <>
                  <div className="payment-detail-audit__cell">
                    <span>עודכן ע״י</span>
                    <strong>{payload.updatedByName ?? "—"}</strong>
                  </div>
                  <div className="payment-detail-audit__cell">
                    <span>תאריך עדכון</span>
                    <strong dir="ltr">{fmtDateShort(payload.updatedDateYmd)}</strong>
                  </div>
                  <div className="payment-detail-audit__cell">
                    <span>שעת עדכון</span>
                    <strong dir="ltr">{payload.updatedTimeHm}</strong>
                  </div>
                </>
              ) : null}
            </div>
          </>
        )}

        <div className="payment-detail-foot">
          <button type="button" className="adm-btn adm-btn--ghost" onClick={onClose}>
            סגור
          </button>
          {payload?.orderId ? (
            <button type="button" className="adm-btn adm-btn--ghost" onClick={openOrder}>
              פתח הזמנה
            </button>
          ) : null}
          <button type="button" className="adm-btn adm-btn--primary" onClick={openPaymentIntake} disabled={!payload}>
            <ExternalLink size={14} aria-hidden /> פתח קליטת תשלום
          </button>
        </div>
      </div>
    </div>
  );
}
