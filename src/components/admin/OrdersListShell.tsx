"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OrderStatus, PaymentMethod } from "@prisma/client";
import { Plus } from "lucide-react";
import { updateOrderListStatusAction } from "@/app/admin/capture/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { orderCountryBadgeClass, orderCountryLabel } from "@/lib/order-countries";
import { orderCaptureSplitMethodLabel } from "@/lib/order-capture-payment-methods";
import type { ParsedDateFilter } from "@/lib/work-week";

export type OrderListRow = {
  id: string;
  orderNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  orderDateYmd: string | null;
  orderDateTime: string | null;
  weekCode: string | null;
  status: string;
  sourceCountry: string | null;
  paymentType: string | null;
  createdByName: string | null;
  dealAmountUsd: string | null;
  commissionAmountUsd: string | null;
  totalAmountUsd: string | null;
  totalAmountIls: string | null;
  paymentStatus: "unpaid" | "partial" | "paid";
};

type OrdersSummary = {
  totalOrders: string;
  totalPaymentsUsd: string;
  totalDebtIls: string;
};

function paymentTypeLabel(paymentType: string | null): string {
  if (!paymentType) return "—";
  return orderCaptureSplitMethodLabel(paymentType as PaymentMethod);
}

/** ערך ל־select בשורה — רק שלושה מצבי עבודה */
function orderStatusToInlineValue(status: string): OrderStatus {
  if (status === OrderStatus.OPEN || status === OrderStatus.COMPLETED) return status;
  if (
    status === OrderStatus.WAITING_FOR_EXECUTION ||
    status === OrderStatus.SENT ||
    status === OrderStatus.WAITING_FOR_CHINA_EXECUTION ||
    status === OrderStatus.WITHDRAWAL_FROM_SUPPLIER
  )
    return OrderStatus.WAITING_FOR_EXECUTION;
  return OrderStatus.WAITING_FOR_EXECUTION;
}

function inlineStatusBadgeClass(sel: OrderStatus): string {
  if (sel === OrderStatus.COMPLETED) return "adm-badge-sel--success";
  if (sel === OrderStatus.OPEN) return "adm-badge-sel--open";
  return "adm-badge-sel--warning";
}

type Props = {
  orders: OrderListRow[];
  summary: OrdersSummary;
  canCreateOrders: boolean;
  canEditOrders: boolean;
  canViewCustomerCard: boolean;
  dateRange: ParsedDateFilter;
};

export function OrdersListShell({
  orders,
  summary,
  canCreateOrders,
  canEditOrders,
  canViewCustomerCard,
  dateRange,
}: Props) {
  const router = useRouter();
  const { openWindow } = useAdminWindows();
  const [rows, setRows] = useState<OrderListRow[]>(orders);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(orders);
  }, [orders]);

  const newOrder = useCallback(() => {
    if (!canCreateOrders) return;
    openWindow({ type: "orderCapture", props: { mode: "create" } });
  }, [canCreateOrders, openWindow]);

  const openCustomerFromCell = useCallback(
    (e: React.MouseEvent, customerId: string | null) => {
      e.preventDefault();
      e.stopPropagation();
      if (!canViewCustomerCard || !customerId) return;
      openWindow({ type: "customerCard", props: { customerId, customerName: "", initialTab: "details" } });
    },
    [canViewCustomerCard, openWindow],
  );

  const openOrderOverlay = useCallback(
    (orderId: string) => {
      if (canEditOrders) {
        openWindow({ type: "orderCapture", props: { mode: "edit", orderId } });
      } else {
        router.push(`/admin/orders/${orderId}`);
      }
    },
    [canEditOrders, openWindow, router],
  );

  const onRowStatusChange = useCallback(
    async (orderId: string, next: OrderStatus) => {
      setListErr(null);
      const prevSnapshot = rows;
      setRows((cur) => cur.map((r) => (r.id === orderId ? { ...r, status: next } : r)));
      setBusyId(orderId);
      const res = await updateOrderListStatusAction(orderId, next);
      setBusyId(null);
      if (!res.ok) {
        setRows(prevSnapshot);
        setListErr(res.error);
      }
    },
    [rows],
  );

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

      <p className="adm-orders-range-hint" dir="rtl">
        טווח: {dateRange.fromYmd} — {dateRange.toYmd} · שבוע {dateRange.weekCode}
      </p>

      {listErr ? (
        <p className="adm-orders-inline-err" role="alert">
          {listErr}
        </p>
      ) : null}

      <div className="adm-orders-kpi-row" aria-label="סיכומים">
        <div className="adm-orders-kpi-card adm-orders-kpi-card--gray">
          <span>סה״כ הזמנות</span>
          <strong>{summary.totalOrders}</strong>
        </div>
        <div className="adm-orders-kpi-card adm-orders-kpi-card--green">
          <span>סה״כ תשלומים</span>
          <strong dir="ltr">${summary.totalPaymentsUsd}</strong>
        </div>
        <div className="adm-orders-kpi-card adm-orders-kpi-card--red">
          <span>סה״כ חובות</span>
          <strong dir="ltr">₪{summary.totalDebtIls}</strong>
        </div>
      </div>

      <div className="adm-table-excel-wrap" dir="rtl">
        <table className="adm-table-excel">
          <thead>
            <tr>
              <th>מזהה הזמנה</th>
              <th>תאריך</th>
              <th>שבוע</th>
              <th>לקוח</th>
              <th dir="ltr">סכום ($)</th>
              <th dir="ltr">עמלה ($)</th>
              <th dir="ltr">כולל עמלה ($)</th>
              <th dir="ltr">סכום ₪</th>
              <th>סטטוס</th>
              <th>צורת תשלום</th>
              <th>פותח</th>
              <th>מדינה</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="adm-table-empty">
                  אין הזמנות בטווח הנבחר.
                </td>
              </tr>
            ) : (
              rows.map((o) => {
                const selVal = orderStatusToInlineValue(o.status);
                return (
                  <tr
                    key={o.id}
                    className="adm-table-excel-row"
                    onClick={() => openOrderOverlay(o.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openOrderOverlay(o.id);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <td dir="ltr" className="adm-table-excel-num">
                      <button
                        type="button"
                        className="adm-table-excel-link adm-table-excel-link--btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOrderOverlay(o.id);
                        }}
                      >
                        {o.orderNumber ?? "—"}
                      </button>
                    </td>
                    <td className="adm-table-excel-date" dir="ltr">
                      {o.orderDateTime ?? o.orderDateYmd ?? "—"}
                    </td>
                    <td dir="ltr" className="adm-table-excel-week">
                      {o.weekCode ?? "—"}
                    </td>
                    <td className="adm-table-excel-cust" title={o.customerPhone ? `טלפון: ${o.customerPhone}` : undefined}>
                      {canViewCustomerCard && o.customerId ? (
                        <button
                          type="button"
                          className="adm-table-excel-cust-btn"
                          onClick={(e) => openCustomerFromCell(e, o.customerId)}
                        >
                          {o.customerName ?? "—"}
                        </button>
                      ) : (
                        <strong className="adm-table-excel-cust-strong">{o.customerName ?? "—"}</strong>
                      )}
                    </td>
                    <td dir="ltr" className="adm-table-excel-money">
                      {o.dealAmountUsd ?? "—"}
                    </td>
                    <td dir="ltr" className="adm-table-excel-money">
                      {o.commissionAmountUsd ?? "—"}
                    </td>
                    <td dir="ltr" className="adm-table-excel-money adm-table-excel-money--strong">
                      {o.totalAmountUsd ?? "—"}
                    </td>
                    <td dir="ltr" className="adm-table-excel-money">
                      {o.totalAmountIls ?? "—"}
                    </td>
                    <td className="adm-table-excel-status-cell" onClick={(e) => e.stopPropagation()}>
                      <select
                        className={`adm-table-status-sel ${inlineStatusBadgeClass(selVal)}`}
                        value={selVal}
                        disabled={!canEditOrders || busyId === o.id}
                        aria-label="סטטוס הזמנה"
                        onChange={(e) => void onRowStatusChange(o.id, e.target.value as OrderStatus)}
                      >
                        <option value={OrderStatus.OPEN}>פתוחה</option>
                        <option value={OrderStatus.WAITING_FOR_EXECUTION}>בטיפול</option>
                        <option value={OrderStatus.COMPLETED}>מוכן</option>
                      </select>
                    </td>
                    <td>{paymentTypeLabel(o.paymentType)}</td>
                    <td>{o.createdByName ?? "—"}</td>
                    <td>
                      <span className={orderCountryBadgeClass(o.sourceCountry)}>{orderCountryLabel(o.sourceCountry)}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="adm-orders-hint">
        {canEditOrders ? "לחיצה על שורה פותחת עריכת הזמנה (חלון). מי לא יכול לערוך — מעבר לדף ההזמנה." : "לחיצה על שורה פותחת את דף ההזמנה."}
      </p>
    </div>
  );
}
