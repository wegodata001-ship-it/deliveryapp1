"use client";

import { Fragment, useEffect, useState } from "react";
import {
  listPaymentMethodAutoAdjustmentsAction,
  markPaymentMethodAutoAdjustmentReviewedAction,
  type PaymentMethodAdjustmentAdminRow,
} from "@/app/admin/payments-updated/payment-method-adjustment-actions";
import { PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS } from "@/lib/payment-method-auto-adjustment";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL");
}

function fmtUsd(amount: string): string {
  return `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function reasonLabel(code: string): string {
  return PAYMENT_METHOD_ADJUSTMENT_REASON_OPTIONS.find((row) => row.code === code)?.label ?? code;
}

export function PaymentMethodAdjustmentsClient() {
  const [rows, setRows] = useState<PaymentMethodAdjustmentAdminRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    const res = await listPaymentMethodAutoAdjustmentsAction();
    setLoading(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setRows(res.rows);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="adm-page--page-scroll">
      <div className="adm-order-detail-head">
        <div>
          <h1 className="adm-page-title adm-page-title--sm">התאמות אמצעי תשלום</h1>
          <p className="adm-order-detail-sub">בקרה ואודיט להתאמות אוטומטיות שבוצעו בקליטת תשלום.</p>
        </div>
        <button type="button" className="adm-btn" onClick={() => void load()} disabled={loading}>
          רענן
        </button>
      </div>

      {err ? <p className="adm-inline-error">{err}</p> : null}

      <table className="adm-table">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>עובד</th>
            <th>לקוח</th>
            <th>מאמצעי</th>
            <th>לאמצעי</th>
            <th>סכום</th>
            <th>סיבה</th>
            <th>מס׳ הזמנות</th>
            <th>סטטוס</th>
            <th>צפייה</th>
          </tr>
        </thead>
        <tbody>
          {!loading && rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="adm-table-empty">אין התאמות אמצעי תשלום להצגה.</td>
            </tr>
          ) : rows.map((row) => (
            <Fragment key={row.id}>
              <tr>
                <td dir="ltr">{fmtDateTime(row.createdAtIso)}</td>
                <td>{row.employeeName}</td>
                <td>{row.customerName}{row.customerCode ? <div dir="ltr">#{row.customerCode}</div> : null}</td>
                <td>{row.fromLabel}</td>
                <td>{row.toLabel}</td>
                <td dir="ltr">{fmtUsd(row.amountUsd)}</td>
                <td>{reasonLabel(row.details.reasonCode)}</td>
                <td>{row.affectedOrdersCount}</td>
                <td>{row.reviewed ? "נבדק" : "חדש"}</td>
                <td>
                  <button type="button" className="adm-btn" onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
                    צפייה
                  </button>
                </td>
              </tr>
              {expandedId === row.id ? (
                <tr>
                  <td colSpan={10}>
                    <div className="adm-order-detail-card">
                      <h2 className="adm-order-detail-h">פרטי התאמה</h2>
                      <p><strong>לקוח:</strong> {row.customerName}</p>
                      <p><strong>עובד שביצע:</strong> {row.employeeName}</p>
                      <p><strong>תאריך ושעה:</strong> <span dir="ltr">{fmtDateTime(row.createdAtIso)}</span></p>
                      <p><strong>סכום:</strong> <span dir="ltr">{fmtUsd(row.amountUsd)}</span></p>
                      <p><strong>מסלול:</strong> {row.fromLabel} → {row.toLabel}</p>
                      <p><strong>סיבה:</strong> {reasonLabel(row.details.reasonCode)}</p>
                      <p><strong>פירוט העובד:</strong> {row.reasonText}</p>
                      <table className="adm-table">
                        <thead>
                          <tr>
                            <th>מספר הזמנה</th>
                            <th>לפני</th>
                            <th>שינוי</th>
                            <th>אחרי</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.details.affectedOrders.map((order) => (
                            <tr key={order.orderId}>
                              <td dir="ltr">{order.orderNumber}</td>
                              <td dir="ltr">{order.beforeAllocation.map((line) => `${line.paymentMethod} ${line.amount}`).join(" | ") || "—"}</td>
                              <td dir="ltr">{fmtUsd(order.movedUsd)}</td>
                              <td dir="ltr">{order.afterAllocation.map((line) => `${line.paymentMethod} ${line.amount}`).join(" | ") || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!row.reviewed ? (
                        <button
                          type="button"
                          className="adm-btn adm-btn--primary"
                          onClick={async () => {
                            const res = await markPaymentMethodAutoAdjustmentReviewedAction(row.id);
                            if (res.ok) void load();
                          }}
                        >
                          סמן כנבדק
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
