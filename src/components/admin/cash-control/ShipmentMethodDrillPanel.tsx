"use client";

import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { num } from "@/components/admin/cash-flow/shared";
import { PaymentMethodColorDot } from "@/components/admin/PaymentMethodColorDot";
import { getPaymentMethodUI } from "@/lib/payment-method-ui";

export type ShipmentMethodDrillPanelProps = {
  method: string | null | undefined;
  methodLabel: string | undefined;
  loading: boolean;
  rows: CashDailyMethodDetailRow[] | null;
};

/** פירוט קליטות משלוחים — אותו מבנה cc-block כמו בקרת קופה רגילה */
export function ShipmentMethodDrillPanel({
  method,
  methodLabel,
  loading,
  rows,
}: ShipmentMethodDrillPanelProps) {
  const pmUi = getPaymentMethodUI(method, methodLabel);

  return (
    <section
      className={`cc-block cc-block--detail cc-slide ${pmUi.cssClass}`}
      style={{
        borderColor: pmUi.border,
        background: pmUi.background,
      }}
    >
      <header className="cc-block__head">
        <div className="cc-block__title">
          פירוט קליטות משלוחים —{" "}
          <PaymentMethodColorDot method={method} label={methodLabel} size={8} />
        </div>
        <span className="cc-block__note">כספי משלוחים בלבד</span>
      </header>
      {loading ? (
        <p className="cc-loading">טוען פירוט…</p>
      ) : (
        <div className="cc-summary__scroll">
          <table className="cc-table">
            <thead>
              <tr>
                <th>שעה</th>
                <th>לקוח</th>
                <th>סכום</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.paymentId}>
                  <td>{r.timeHm}</td>
                  <td>{r.customerName ?? "—"}</td>
                  <td dir="ltr" className="cc-num">
                    <span className="cc-amount-link--pm" style={{ color: pmUi.textColor, fontWeight: 700 }}>
                      {fmtDailyMoney("ILS", num(r.amount))}
                    </span>
                  </td>
                </tr>
              ))}
              {!rows?.length ? (
                <tr>
                  <td colSpan={3} className="cc-muted">
                    אין קליטות ליום זה
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
