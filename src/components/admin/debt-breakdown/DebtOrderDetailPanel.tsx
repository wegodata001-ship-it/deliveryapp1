"use client";

import { X } from "lucide-react";
import { formatUsdDisplay } from "@/lib/money-format";
import type { DebtBreakdownOpenOrder, DebtBreakdownPaymentRow } from "@/lib/customer-debt-breakdown-types";

function money(n: number): string {
  return `$${formatUsdDisplay(n)}`;
}

export function DebtOrderDetailPanel({
  order,
  payments,
  onClose,
}: {
  order: DebtBreakdownOpenOrder;
  payments: DebtBreakdownPaymentRow[];
  onClose: () => void;
}) {
  const orderPayments = payments.filter((p) => p.orderId === order.orderId && !p.isCancelled);

  return (
    <div className="debt-order-detail" dir="rtl">
      <header className="debt-order-detail__head">
        <h4>פירוט הזמנה {order.orderNumber}</h4>
        <button type="button" className="debt-order-detail__close" onClick={onClose} aria-label="סגור">
          <X size={16} />
        </button>
      </header>
      <dl className="debt-order-detail__grid">
        <div><dt>תאריך</dt><dd dir="ltr">{order.orderDateYmd}</dd></div>
        <div><dt>שבוע</dt><dd dir="ltr">{order.weekCode ?? "—"}</dd></div>
        <div><dt>מדינה</dt><dd>{order.sourceCountry ?? "—"}</dd></div>
        <div><dt>סכום מקור</dt><dd dir="ltr">{money(order.originalAmount)}</dd></div>
        <div><dt>עמלה</dt><dd dir="ltr">{money(order.commission)}</dd></div>
        <div><dt>סכום כולל</dt><dd dir="ltr">{money(order.totalDue)}</dd></div>
        <div><dt>שולם</dt><dd dir="ltr">{money(order.paidAmount)}</dd></div>
        <div><dt>יתרה פתוחה</dt><dd dir="ltr" className="debt-order-detail__bal">{money(order.remainingBalance)}</dd></div>
        <div><dt>סטטוס</dt><dd>{order.statusLabel}</dd></div>
      </dl>
      <p className="debt-order-detail__explain">
        החוב הפתוח של הזמנה {order.orderNumber} נוצר מסכום כולל של {money(order.totalDue)}. עד היום שולמו{" "}
        {money(order.paidAmount)}, ולכן נותרו {money(order.remainingBalance)} לתשלום.
      </p>
      <h5>היסטוריית תשלומים להזמנה</h5>
      <table className="debt-breakdown-table debt-breakdown-table--compact">
        <thead>
          <tr>
            <th>תאריך</th>
            <th>תשלום</th>
            <th>סכום</th>
            <th>אמצעי</th>
            <th>יתרה אחרי</th>
          </tr>
        </thead>
        <tbody>
          {orderPayments.length === 0 ? (
            <tr>
              <td colSpan={5}>אין תשלומים להזמנה זו</td>
            </tr>
          ) : (
            orderPayments.map((p) => (
              <tr key={p.id}>
                <td dir="ltr">{p.paymentDateYmd}</td>
                <td dir="ltr">{p.paymentCode ?? "—"}</td>
                <td dir="ltr">{money(p.amountUsd)}</td>
                <td>{p.paymentMethodLabel}</td>
                <td dir="ltr">{p.balanceAfterUsd != null ? money(p.balanceAfterUsd) : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DebtOrderDetailPanel;
