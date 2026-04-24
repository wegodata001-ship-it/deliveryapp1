"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { withQuery } from "@/lib/admin-url-query";

export type OrderListRow = {
  id: string;
  orderNumber: string | null;
  customerName: string | null;
  orderDateYmd: string | null;
  status: string;
  totalUsd: string | null;
};

const STATUS_HE: Record<string, string> = {
  OPEN: "פתוחה",
  CANCELLED: "מבוטלת",
  WAITING_FOR_EXECUTION: "ממתינה לביצוע",
  WITHDRAWAL_FROM_SUPPLIER: "משיכה מספק",
  SENT: "נשלחה",
  WAITING_FOR_CHINA_EXECUTION: "ממתינה לסין",
  COMPLETED: "הושלמה",
};

type Props = {
  orders: OrderListRow[];
  canCreateOrders: boolean;
  canEditOrders: boolean;
};

export function OrdersListShell({ orders, canCreateOrders, canEditOrders }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const activeId = sp.get("orderWork");
  const isRowActive = (id: string) => activeId === id;

  function openOrder(id: string) {
    if (!canEditOrders) return;
    router.push(withQuery(pathname, sp, { orderWork: id }));
  }

  function newOrder() {
    if (!canCreateOrders) return;
    router.push(withQuery(pathname, sp, { orderWork: "new" }));
  }

  return (
    <div className="adm-orders-work">
      <div className="adm-orders-toolbar">
        <h1 className="adm-page-title adm-page-title--sm">הזמנות</h1>
        {canCreateOrders ? (
          <button type="button" className="adm-btn adm-btn--primary adm-btn--dense" onClick={newOrder}>
            <Plus size={16} strokeWidth={2.2} aria-hidden />
            הזמנה חדשה
          </button>
        ) : null}
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table adm-table--dense">
          <thead>
            <tr>
              <th>מספר</th>
              <th>לקוח</th>
              <th>תאריך</th>
              <th>סטטוס</th>
              <th dir="ltr">USD</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="adm-table-empty">
                  אין הזמנות בטווח הנבחר.
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr
                  key={o.id}
                  className={isRowActive(o.id) ? "adm-table-row-active" : undefined}
                  onClick={canEditOrders ? () => openOrder(o.id) : undefined}
                  onKeyDown={
                    canEditOrders
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openOrder(o.id);
                          }
                        }
                      : undefined
                  }
                  tabIndex={canEditOrders ? 0 : undefined}
                  role={canEditOrders ? "button" : undefined}
                  aria-current={isRowActive(o.id) ? "true" : undefined}
                  data-clickable={canEditOrders ? "true" : undefined}
                >
                  <td dir="ltr">{o.orderNumber ?? "—"}</td>
                  <td>{o.customerName ?? "—"}</td>
                  <td>{o.orderDateYmd ?? "—"}</td>
                  <td>{STATUS_HE[o.status] ?? o.status}</td>
                  <td dir="ltr">{o.totalUsd ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!canEditOrders ? (
        <p className="adm-orders-hint">אין הרשאת עריכה — לחיצה על שורה לפתיחה בפאנל אינה זמינה.</p>
      ) : null}
    </div>
  );
}
