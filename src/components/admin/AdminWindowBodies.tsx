"use client";

import { useEffect, useState } from "react";
import { OrderStatus } from "@prisma/client";
import { getCustomerCardSnapshotAction, type CustomerCardSnapshot } from "@/app/admin/capture/actions";
import type { CustomerCardWindowProps } from "@/lib/admin-windows";

const ORDER_STATUS_HE: Record<OrderStatus, string> = {
  OPEN: "פתוחה",
  CANCELLED: "מבוטלת",
  WAITING_FOR_EXECUTION: "ממתינה לביצוע",
  WITHDRAWAL_FROM_SUPPLIER: "משיכה מספק",
  SENT: "נשלחה",
  WAITING_FOR_CHINA_EXECUTION: "ממתינה לביצוע סין",
  COMPLETED: "הושלמה",
};

function displayCustomerCode(s: CustomerCardSnapshot): string {
  const c = s.customerCode?.trim();
  if (c) return c;
  return "—";
}

function formatUsdSummary(s: string): string {
  const n = Number(s.replace(",", ".").trim());
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CustomerCardWindowBody({ customerId }: CustomerCardWindowProps) {
  const [snap, setSnap] = useState<CustomerCardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId?.trim()) {
      setSnap(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getCustomerCardSnapshotAction(customerId).then((row) => {
      if (!cancelled) {
        setSnap(row);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  if (!customerId?.trim()) {
    return (
      <div className="adm-win-scroll-body">
        <p className="adm-win-meta">כרטסת לקוח — בחרו לקוח מהרשימה או מהזמנה.</p>
      </div>
    );
  }

  if (loading || !snap) {
    return (
      <div className="adm-win-scroll-body">
        <p className="adm-win-meta">{loading ? "טוען…" : "לא נמצאו נתונים ללקוח."}</p>
      </div>
    );
  }

  const phoneLine = [snap.phone, snap.secondPhone].filter(Boolean).join(" · ") || "—";

  return (
    <div className="adm-win-scroll-body adm-cust-card-body">
      <div className="adm-cust-card-shell">
        <header className="adm-cust-card-header">
          <h2 className="adm-cust-card-name">{snap.displayName}</h2>
          <div className="adm-cust-card-detail-rows">
            <p className="adm-cust-card-sub" dir="ltr">
              טלפון: {phoneLine}
            </p>
            <p className="adm-cust-card-sub" dir="ltr">
              מזהה: {displayCustomerCode(snap)}
            </p>
            <p className="adm-cust-card-sub">עיר: {snap.city?.trim() ? snap.city : "—"}</p>
            {snap.customerType?.trim() ? (
              <p className="adm-cust-card-sub">סוג: {snap.customerType}</p>
            ) : null}
          </div>
        </header>

        <div className="adm-cust-summary-box" aria-labelledby="cust-card-bal-label">
          <div id="cust-card-bal-label" className="adm-cust-summary-label">
            סה״כ הזמנות
          </div>
          <div className="adm-cust-summary-amount" dir="ltr">
            ${formatUsdSummary(snap.ordersUsdSum)}
          </div>
          <div className="adm-cust-summary-count">{snap.orderCount} הזמנות</div>
        </div>

        <section className="adm-cust-card-orders-wrap" aria-labelledby="cust-card-ord">
          <h3 id="cust-card-ord" className="adm-cust-card-orders-title">
            הזמנות אחרונות
          </h3>
          {snap.recentOrders.length === 0 ? (
            <p className="adm-cust-card-empty">אין הזמנות.</p>
          ) : (
            <div className="adm-cust-card-table-scroll">
              <table className="adm-cust-card-orders-table">
                <thead>
                  <tr>
                    <th scope="col">מס׳</th>
                    <th scope="col">תאריך</th>
                    <th scope="col">USD</th>
                    <th scope="col">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.recentOrders.map((o, i) => (
                    <tr key={`${o.orderNumber ?? "n"}-${o.orderDateYmd}-${i}`}>
                      <td dir="ltr">{o.orderNumber ?? "—"}</td>
                      <td dir="ltr">{o.orderDateYmd}</td>
                      <td dir="ltr" className="adm-cust-card-td-usd">
                        ${formatUsdSummary(o.totalUsd)}
                      </td>
                      <td>
                        <span className={`adm-ord-status adm-ord-status--${o.status}`}>
                          {ORDER_STATUS_HE[o.status] ?? o.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function CreateCustomerWindowBody() {
  return (
    <div className="adm-win-scroll-body">
      <p className="adm-muted-keys" style={{ marginTop: 0 }}>
        טופס יצירת לקוח יחובר כאן (שמירה, הרשאות, שדות חובה).
      </p>
    </div>
  );
}
