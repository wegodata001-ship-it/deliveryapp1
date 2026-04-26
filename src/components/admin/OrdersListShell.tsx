"use client";

import { Plus } from "lucide-react";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";

export type OrderListRow = {
  id: string;
  orderNumber: string | null;
  customerId: string | null;
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
  canViewCustomerCard: boolean;
};

export function OrdersListShell({ orders, canCreateOrders, canEditOrders, canViewCustomerCard }: Props) {
  const { openWindow } = useAdminWindows();

  function openOrder(id: string) {
    if (!canEditOrders) return;
    openWindow({ type: "orderCapture", props: { mode: "edit", orderId: id } });
  }

  function newOrder() {
    if (!canCreateOrders) return;
    openWindow({ type: "orderCapture", props: { mode: "create" } });
  }

  function openCustomerFromCell(e: React.MouseEvent, customerId: string | null) {
    e.stopPropagation();
    if (!canViewCustomerCard || !customerId) return;
    openWindow({ type: "customerCard", props: { customerId } });
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
                  data-clickable={canEditOrders ? "true" : undefined}
                >
                  <td dir="ltr">{o.orderNumber ?? "—"}</td>
                  <td
                    className={canViewCustomerCard && o.customerId ? "adm-table-cell-cust" : undefined}
                    onClick={
                      canViewCustomerCard && o.customerId
                        ? (e) => openCustomerFromCell(e, o.customerId)
                        : undefined
                    }
                    title={canViewCustomerCard && o.customerId ? "לחיצה לכרטסת לקוח" : undefined}
                  >
                    {o.customerName ?? "—"}
                  </td>
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
