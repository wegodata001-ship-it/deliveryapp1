"use client";

import type { CashDailyMethodDetailRow } from "@/app/admin/cash-control/daily-types";
import { fmtDailyMoney } from "@/lib/cash-control-daily";
import { num } from "@/components/admin/cash-flow/shared";

export type ShipmentMethodDrillPanelProps = {
  methodLabel: string | undefined;
  loading: boolean;
  rows: CashDailyMethodDetailRow[] | null;
};

/** פירוט קליטות משלוחים — אותו מבנה cc-block כמו בקרת קופה רגילה */
export function ShipmentMethodDrillPanel({
  methodLabel,
  loading,
  rows,
}: ShipmentMethodDrillPanelProps) {
  return (
    <section className="cc-block cc-block--detail cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">פירוט קליטות משלוחים — {methodLabel}</div>
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
                    {fmtDailyMoney("ILS", num(r.amount))}
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
