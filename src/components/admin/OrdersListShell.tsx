"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import { OS } from "@/lib/order-status-slugs";
import { inlineStatusBadgeClass, orderStatusToQuickSelectValue } from "@/constants/order-status";
import { useOrderStatusCatalog } from "@/components/admin/OrderStatusCatalogProvider";
import { ChevronDown, FileText, Plus, Sheet } from "lucide-react";
import {
  updateOrderListPaymentLocationAction,
  updateOrderListPaymentMethodAction,
  updateOrderListStatusAction,
} from "@/app/admin/capture/actions";
import { exportOrdersListPdfHtmlAction, type OrdersPdfExportMode } from "@/app/admin/orders/export-orders-pdf-action";
import { OrderEditLockGateModal, type OrderEditLockGatePayload } from "@/components/admin/OrderEditLockGateModal";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS,
  orderCaptureSplitMethodLabel,
} from "@/lib/order-capture-payment-methods";
import type { ParsedDateFilter } from "@/lib/work-week";
import { OrdersListPaginationBar } from "@/components/admin/OrdersListPaginationBar";
import { formatMoneyAmount } from "@/lib/money-format";

export type OrderListRow = {
  id: string;
  orderNumber: string | null;
  customerId: string | null;
  /** קוד לקוח snapshot — מוצג בעמודה נפרדת */
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  orderDateYmd: string | null;
  orderDateTime: string | null;
  weekCode: string | null;
  status: string;
  sourceCountry: string | null;
  paymentType: string | null;
  /** מקום תשלום — IntakeLocation / PaymentPoint id (לסינון) */
  paymentLocationId: string | null;
  /** מקום תשלום — שם להצגה */
  paymentLocationName: string | null;
  createdByName: string | null;
  dealAmountUsd: string | null;
  commissionAmountUsd: string | null;
  totalAmountUsd: string | null;
  /** יתרה בדולרים (סה״כ − שולם) — לא מוצגת כעמודה, אך נשמרת לתאימות */
  balanceUsd: string | null;
  totalAmountIls: string | null;
  paymentStatus: "unpaid" | "partial" | "paid";
  /** סימון בקשת עריכה / נעילה — הזמנות מוכנות (COMPLETED) או מבוטלות */
  editBadge?: "pending" | "unlock" | "rejected" | "locked" | null;
  /** כש־editBadge=pending — האם הבקשה הממתינה היא של המשתמש הנוכחי */
  pendingEditOwnedByMe?: boolean;
  /** מניעת שינוי סטטוס מהיר לעובד בלי אישור */
  quickStatusLocked?: boolean;
};

type OrdersStatusBucket = {
  /** מספר הזמנות מפורמט לעברית */
  count: string;
  /** סכום סה״כ USD מפורמט (en-US, 2 ספרות) */
  totalUsd: string;
};

export type OrdersStatusSummary = {
  open: OrdersStatusBucket;
  inProgress: OrdersStatusBucket;
  completed: OrdersStatusBucket;
  cancelled: OrdersStatusBucket;
  debtWithdrawal: OrdersStatusBucket;
};

export type OrdersListPagination = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

function paymentTypeLabel(paymentType: string | null): string {
  if (!paymentType) return "—";
  return orderCaptureSplitMethodLabel(paymentType as PaymentMethod);
}

/** המרה זהירה ממחרוזת מפורמטת (לדוגמה "1,234.50") למספר; null אם לא ניתן. */
function parseNumeric(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function fmtUsd(n: number): string {
  return formatMoneyAmount(n);
}

function paymentMethodTone(m: string | null): string {
  switch (m) {
    case PaymentMethod.CASH:
      return "adm-pay-sel--cash";
    case PaymentMethod.CREDIT:
      return "adm-pay-sel--credit";
    case PaymentMethod.BANK_TRANSFER:
      return "adm-pay-sel--bank";
    case PaymentMethod.CHECK:
      return "adm-pay-sel--check";
    default:
      return "adm-pay-sel--none";
  }
}

function orderEditBadgeLabel(
  b: NonNullable<OrderListRow["editBadge"]>,
  orderStatus: string,
): { emoji: string; text: string; cls: string } {
  const isCancelled = orderStatus === OS.CANCELLED;
  switch (b) {
    case "pending":
      return { emoji: "🟠", text: "ממתין לאישור מנהל", cls: "adm-order-edit-badge--pending" };
    case "unlock":
      return { emoji: "🟢", text: "אושר לעריכה", cls: "adm-order-edit-badge--unlock" };
    case "rejected":
      return { emoji: "🔴", text: "נדחה", cls: "adm-order-edit-badge--rejected" };
    case "locked":
      return isCancelled
        ? {
            emoji: "🔒",
            text: "הזמנה נעולה — ממתין לאישור מנהל",
            cls: "adm-order-edit-badge adm-order-edit-badge--locked-cancelled",
          }
        : {
            emoji: "🔒",
            text: "הזמנה נעולה — ממתין לאישור מנהל",
            cls: "adm-order-edit-badge adm-order-edit-badge--locked-ready",
          };
    default:
      return { emoji: "", text: "", cls: "" };
  }
}

type Props = {
  orders: OrderListRow[];
  statusSummary: OrdersStatusSummary;
  pagination: OrdersListPagination;
  /** ADMIN במערכת = מנהל/אחראי — עוקף נעילת עריכה */
  viewerIsAdmin: boolean;
  canCreateOrders: boolean;
  canEditOrders: boolean;
  canViewCustomerCard: boolean;
  dateRange: ParsedDateFilter;
  paymentLocationOptions: { id: string; label: string }[];
};

export function OrdersListShell({
  orders,
  statusSummary,
  pagination,
  viewerIsAdmin,
  canCreateOrders,
  canEditOrders,
  canViewCustomerCard,
  dateRange,
  paymentLocationOptions,
}: Props) {
  const router = useRouter();
  const { openWindow } = useAdminWindows();
  const { quickOptions: statusQuickOptions } = useOrderStatusCatalog();
  const [rows, setRows] = useState<OrderListRow[]>(orders);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [lockModal, setLockModal] = useState<OrderEditLockGatePayload | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const pdfWrapRef = useRef<HTMLDivElement>(null);

  const paymentLocationLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of paymentLocationOptions) m.set(p.id, p.label);
    return m;
  }, [paymentLocationOptions]);

  const tableRows = useMemo(() => rows, [rows]);

  const paginationLabel = useMemo(() => {
    const { page, pageSize, totalCount } = pagination;
    if (totalCount === 0) return "אין הזמנות בתצוגה";
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, totalCount);
    return `מציג ${from.toLocaleString("he-IL")}–${to.toLocaleString("he-IL")} מתוך ${totalCount.toLocaleString("he-IL")}`;
  }, [pagination]);

  useEffect(() => {
    setRows(orders);
  }, [orders]);

  useEffect(() => {
    if (!pdfMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (pdfWrapRef.current && !pdfWrapRef.current.contains(e.target as Node)) {
        setPdfMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pdfMenuOpen]);

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

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3800);
  }, []);

  const openOrderOverlay = useCallback(
    (orderId: string, row?: OrderListRow) => {
      if (!canEditOrders) {
        router.push(`/admin/orders/${orderId}`);
        return;
      }
      if (row && !viewerIsAdmin) {
        const sens = row.status === OS.COMPLETED || row.status === OS.CANCELLED;
        if (sens) {
          if (row.editBadge === "unlock") {
            openWindow({ type: "orderCapture", props: { mode: "edit", orderId } });
            return;
          }
          if (row.editBadge === "pending") {
            setLockModal({
              kind: "prelock",
              variant: row.pendingEditOwnedByMe ? "pending_mine" : "pending_other",
              orderId,
              orderNumber: row.orderNumber,
              status: row.status,
            });
            return;
          }
          if (row.editBadge === "locked" || row.editBadge === "rejected") {
            setLockModal({
              kind: "prelock",
              variant: row.editBadge === "rejected" ? "rejected" : "locked",
              orderId,
              orderNumber: row.orderNumber,
              status: row.status,
            });
            return;
          }
        }
      }
      openWindow({ type: "orderCapture", props: { mode: "edit", orderId } });
    },
    [canEditOrders, openWindow, router, viewerIsAdmin],
  );

  const onRowStatusChange = useCallback(
    async (orderId: string, next: string) => {
      setListErr(null);
      const prevSnapshot = rows;
      setRows((cur) => cur.map((r) => (r.id === orderId ? { ...r, status: next } : r)));
      setBusyId(orderId);
      const res = await updateOrderListStatusAction(orderId, next);
      setBusyId(null);
      if (!res.ok) {
        setRows(prevSnapshot);
        setListErr(res.error);
        return;
      }
      // משיכה מהחוב — מעדכנים גם את "שולם" ויתרת ההזמנה לפי הסכום שנמשך בפועל
      if (next === OS.DEBT_WITHDRAWAL && typeof res.debtWithdrawalUsd === "number") {
        const withdrawn = res.debtWithdrawalUsd;
        setRows((cur) =>
          cur.map((r) => {
            if (r.id !== orderId) return r;
            const total = parseNumeric(r.totalAmountUsd) ?? 0;
            const newBalance = Math.max(0, total - withdrawn);
            return {
              ...r,
              paymentStatus:
                total > 0.01 && withdrawn >= total - 0.02
                  ? "paid"
                  : withdrawn > 0.01
                    ? "partial"
                    : "unpaid",
              balanceUsd: fmtUsd(newBalance),
            };
          }),
        );
      }
    },
    [rows],
  );

  const onRowPaymentMethodChange = useCallback(
    async (orderId: string, raw: string) => {
      setListErr(null);
      const next = raw ? (raw as PaymentMethod) : null;
      const prevSnapshot = rows;
      setRows((cur) => cur.map((r) => (r.id === orderId ? { ...r, paymentType: next } : r)));
      setBusyId(orderId);
      const res = await updateOrderListPaymentMethodAction(orderId, next);
      setBusyId(null);
      if (!res.ok) {
        setRows(prevSnapshot);
        setListErr(res.error);
      }
    },
    [rows],
  );

  const onRowPaymentLocationChange = useCallback(
    async (orderId: string, locId: string) => {
      setListErr(null);
      const nextId = locId || null;
      const nextLabel = nextId ? paymentLocationLabelById.get(nextId) ?? null : null;
      const prevSnapshot = rows;
      setRows((cur) =>
        cur.map((r) =>
          r.id === orderId
            ? { ...r, paymentLocationId: nextId, paymentLocationName: nextLabel }
            : r,
        ),
      );
      setBusyId(orderId);
      const res = await updateOrderListPaymentLocationAction(orderId, nextId);
      setBusyId(null);
      if (!res.ok) {
        setRows(prevSnapshot);
        setListErr(res.error);
      }
    },
    [rows, paymentLocationLabelById],
  );

  const exportFilenameBase = useMemo(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const range = `${dateRange.fromYmd}_${dateRange.toYmd}`;
    return `orders_${range}_${stamp}`;
  }, [dateRange.fromYmd, dateRange.toYmd]);

  const exportToExcel = useCallback(() => {
    const headers = [
      "מזהה הזמנה",
      "תאריך",
      "שבוע",
      "קוד לקוח",
      "שם לקוח",
      "סכום לפני עמלה ($)",
      "סכום כולל עמלה ($)",
      "סכום בשקל (₪)",
      "סטטוס הזמנה",
      "צורת תשלום",
      "מקום תשלום",
    ];
    const escape = (v: string | null | undefined) => {
      const s = (v ?? "").toString().replace(/"/g, '""');
      return /[",\n\r]/.test(s) ? `"${s}"` : s;
    };
    const lines: string[] = [headers.map(escape).join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.orderNumber,
          r.orderDateTime ?? r.orderDateYmd,
          r.weekCode,
          r.customerCode,
          r.customerName,
          r.dealAmountUsd,
          r.totalAmountUsd,
          r.totalAmountIls,
          r.status,
          paymentTypeLabel(r.paymentType),
          r.paymentLocationName,
        ]
          .map(escape)
          .join(","),
      );
    }
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFilenameBase}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows, exportFilenameBase]);

  const printOrdersPdfHtml = useCallback((html: string) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    const cleanup = () => {
      try {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      } catch {
        /* noop */
      }
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        setListErr("לא ניתן להפיק PDF — אנא נסו שוב.");
        return;
      }
      try {
        win.focus();
        win.print();
      } catch {
        /* noop */
      }
      const onAfter = () => {
        win.removeEventListener("afterprint", onAfter);
        setTimeout(cleanup, 100);
      };
      win.addEventListener("afterprint", onAfter);
      setTimeout(cleanup, 60_000);
    };

    const doc = iframe.contentDocument;
    if (!doc) {
      cleanup();
      setListErr("לא ניתן להפיק PDF — אנא נסו שוב.");
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  }, []);

  const runPdfExport = useCallback(
    async (mode: OrdersPdfExportMode) => {
      setPdfMenuOpen(false);
      setListErr(null);
      setPdfLoading(true);
      try {
        const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
        const raw: Record<string, string | string[] | undefined> = {};
        sp.forEach((v, k) => {
          raw[k] = v;
        });
        const res = await exportOrdersListPdfHtmlAction(raw, mode);
        if (!res.ok) {
          setListErr(res.error);
          return;
        }
        printOrdersPdfHtml(res.html);
      } catch {
        setListErr("לא ניתן להפיק PDF — אנא נסו שוב.");
      } finally {
        setPdfLoading(false);
      }
    },
    [printOrdersPdfHtml],
  );

  return (
    <div className="adm-orders-work">
      <div className="adm-orders-toolbar">
        <h1 className="adm-page-title adm-page-title--sm">הזמנות</h1>
        <div className="adm-orders-toolbar-actions">
          <div className="adm-orders-pdf-wrap" ref={pdfWrapRef}>
            <button
              type="button"
              className="adm-export-btn adm-export-btn--pdf adm-export-btn--pdf-split"
              onClick={() => setPdfMenuOpen((o) => !o)}
              disabled={pdfLoading}
              aria-expanded={pdfMenuOpen}
              aria-haspopup="menu"
              title="ייצוא PDF"
            >
              <FileText size={14} strokeWidth={2.2} aria-hidden />
              PDF
              <ChevronDown size={14} strokeWidth={2.2} className="adm-orders-pdf-chev" aria-hidden />
            </button>
            {pdfMenuOpen ? (
              <ul className="adm-orders-pdf-menu" role="menu" dir="rtl">
                <li role="none">
                  <button type="button" role="menuitem" className="adm-orders-pdf-menu__btn" onClick={() => void runPdfExport("regular")}>
                    PDF רגיל
                  </button>
                </li>
                <li role="none">
                  <button type="button" role="menuitem" className="adm-orders-pdf-menu__btn" onClick={() => void runPdfExport("by_place")}>
                    PDF לפי מקום
                  </button>
                </li>
                <li role="none">
                  <button type="button" role="menuitem" className="adm-orders-pdf-menu__btn" onClick={() => void runPdfExport("by_status")}>
                    PDF לפי סטטוס
                  </button>
                </li>
                <li role="none">
                  <button type="button" role="menuitem" className="adm-orders-pdf-menu__btn" onClick={() => void runPdfExport("by_week")}>
                    PDF לפי שבוע
                  </button>
                </li>
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            className="adm-export-btn adm-export-btn--excel"
            onClick={exportToExcel}
            title="ייצוא Excel לפי הסינון הנוכחי"
            aria-label="ייצוא Excel"
          >
            <Sheet size={14} strokeWidth={2.2} aria-hidden />
            EXCEL
          </button>
          {canCreateOrders ? (
            <button type="button" className="adm-btn adm-btn--primary adm-btn--dense" onClick={newOrder}>
              <Plus size={16} strokeWidth={2.2} aria-hidden />
              הזמנה חדשה
            </button>
          ) : null}
        </div>
      </div>

      <p className="adm-orders-range-hint" dir="rtl">
        טווח רשימה: {dateRange.fromYmd} — {dateRange.toYmd}
        {dateRange.ahWeekSelect ? ` · שבוע ${dateRange.ahWeekSelect}` : " · טווח מותאם"}
      </p>

      {listErr ? (
        <p className="adm-orders-inline-err" role="alert">
          {listErr}
        </p>
      ) : null}

      <div className="adm-orders-status-kpi" aria-label="סיכומים לפי סטטוס">
        <div className="adm-status-card adm-status-card--open">
          <span className="adm-status-card-title">פתוחות</span>
          <strong className="adm-status-card-count">{statusSummary.open.count}</strong>
          <span className="adm-status-card-sub">הזמנות</span>
          <span className="adm-status-card-amount" dir="ltr">
            ${statusSummary.open.totalUsd}
          </span>
        </div>
        <div className="adm-status-card adm-status-card--progress">
          <span className="adm-status-card-title">בטיפול</span>
          <strong className="adm-status-card-count">{statusSummary.inProgress.count}</strong>
          <span className="adm-status-card-sub">הזמנות</span>
          <span className="adm-status-card-amount" dir="ltr">
            ${statusSummary.inProgress.totalUsd}
          </span>
        </div>
        <div className="adm-status-card adm-status-card--completed">
          <span className="adm-status-card-title">מוכנות</span>
          <strong className="adm-status-card-count">{statusSummary.completed.count}</strong>
          <span className="adm-status-card-sub">הזמנות</span>
          <span className="adm-status-card-amount" dir="ltr">
            ${statusSummary.completed.totalUsd}
          </span>
        </div>
        <div className="adm-status-card adm-status-card--cancelled">
          <span className="adm-status-card-title">מבוטלות</span>
          <strong className="adm-status-card-count">{statusSummary.cancelled.count}</strong>
          <span className="adm-status-card-sub">הזמנות</span>
          <span className="adm-status-card-amount" dir="ltr">
            ${statusSummary.cancelled.totalUsd}
          </span>
        </div>
        <div className="adm-status-card adm-status-card--withdrawal">
          <span className="adm-status-card-title">משיכה מהחוב</span>
          <strong className="adm-status-card-count">{statusSummary.debtWithdrawal.count}</strong>
          <span className="adm-status-card-sub">הזמנות</span>
          <span className="adm-status-card-amount" dir="ltr">
            ${statusSummary.debtWithdrawal.totalUsd}
          </span>
        </div>
      </div>

      <div className="mobile-table-wrapper adm-table-excel-wrap adm-table-excel-wrap--orders" dir="rtl">
        <table className="adm-table-excel adm-table-excel--orders adm-table-excel--orders-v2">
          <thead>
            <tr>
              <th className="adm-ord-col-num">מזהה הזמנה</th>
              <th className="adm-ord-col-date">תאריך</th>
              <th className="adm-ord-col-week">שבוע</th>
              <th className="adm-ord-col-ccode">קוד לקוח</th>
              <th className="adm-ord-col-cust">שם לקוח</th>
              <th className="adm-ord-col-money adm-ord-col-money--deal" dir="ltr">
                סכום לפני עמלה ($)
              </th>
              <th className="adm-ord-col-money adm-ord-col-money--total" dir="ltr">
                סכום כולל עמלה ($)
              </th>
              <th className="adm-ord-col-money adm-ord-col-ils" dir="ltr">
                סכום בשקל (₪)
              </th>
              <th className="adm-ord-col-status">סטטוס הזמנה</th>
              <th className="adm-ord-col-meta adm-ord-col-pay">צורת תשלום</th>
              <th className="adm-ord-col-meta adm-ord-col-payloc">מקום תשלום</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="adm-table-empty">
                  אין הזמנות בטווח הנבחר.
                </td>
              </tr>
            ) : (
              tableRows.map((o) => {
                const selVal = orderStatusToQuickSelectValue(o.status);
                const editBadgeUi = o.editBadge ? orderEditBadgeLabel(o.editBadge, o.status) : null;
                const isCancelled = o.status === OS.CANCELLED;
                return (
                  <tr
                    key={o.id}
                    className={`adm-table-excel-row${isCancelled ? " adm-order-row--cancelled" : ""}`}
                    onClick={() => openOrderOverlay(o.id, o)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openOrderOverlay(o.id, o);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <td dir="ltr" className="adm-table-excel-num adm-ord-col-num">
                      <button
                        type="button"
                        className="adm-table-excel-link adm-table-excel-link--btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOrderOverlay(o.id, o);
                        }}
                      >
                        {o.orderNumber ?? "—"}
                        {editBadgeUi ? (
                          <span className={`adm-order-edit-badge ${editBadgeUi.cls}`} title={editBadgeUi.text}>
                            {editBadgeUi.emoji} {editBadgeUi.text}
                          </span>
                        ) : null}
                      </button>
                    </td>
                    <td className="adm-table-excel-date adm-ord-col-date" dir="ltr">
                      {o.orderDateTime ?? o.orderDateYmd ?? "—"}
                    </td>
                    <td dir="ltr" className="adm-ord-col-week adm-table-excel-week">
                      {o.weekCode ?? "—"}
                    </td>
                    <td dir="ltr" className="adm-ord-col-ccode adm-table-excel-ccode">
                      {o.customerCode ?? "—"}
                    </td>
                    <td className="adm-table-excel-cust adm-ord-col-cust" title={o.customerPhone ? `טלפון: ${o.customerPhone}` : undefined}>
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
                    <td
                      dir="ltr"
                      className="adm-table-excel-money adm-table-excel-money--usd adm-ord-col-money adm-ord-col-money--deal"
                      title={
                        o.commissionAmountUsd ? `עמלה: ${o.commissionAmountUsd}` : undefined
                      }
                    >
                      {o.dealAmountUsd ?? "—"}
                    </td>
                    <td
                      dir="ltr"
                      className="adm-table-excel-money adm-table-excel-money--usd adm-table-excel-money--strong adm-ord-col-money adm-ord-col-money--total"
                      title={
                        o.commissionAmountUsd ? `כולל עמלה: ${o.commissionAmountUsd}` : undefined
                      }
                    >
                      {o.totalAmountUsd ?? "—"}
                    </td>
                    <td dir="ltr" className="adm-table-excel-money adm-table-excel-money--ils adm-ord-col-ils">
                      {o.totalAmountIls ?? "—"}
                    </td>
                    <td className="adm-table-excel-status-cell adm-ord-col-status" onClick={(e) => e.stopPropagation()}>
                      <select
                        className={`adm-table-status-sel ${inlineStatusBadgeClass(selVal)}`}
                        value={selVal}
                        disabled={!canEditOrders || busyId === o.id || !!o.quickStatusLocked}
                        aria-label="סטטוס הזמנה"
                        onChange={(e) => void onRowStatusChange(o.id, e.target.value)}
                      >
                        {statusQuickOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="adm-ord-col-meta adm-ord-col-pay" onClick={(e) => e.stopPropagation()}>
                      <select
                        className={`adm-pay-sel ${paymentMethodTone(o.paymentType)}`}
                        value={(o.paymentType as string | null) ?? ""}
                        disabled={!canEditOrders || busyId === o.id || !!o.quickStatusLocked}
                        aria-label="צורת תשלום"
                        onChange={(e) => void onRowPaymentMethodChange(o.id, e.target.value)}
                      >
                        <option value="">—</option>
                        {ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="adm-ord-col-meta adm-ord-col-payloc" onClick={(e) => e.stopPropagation()}>
                      <select
                        className="adm-payloc-sel"
                        value={o.paymentLocationId ?? ""}
                        disabled={!canEditOrders || busyId === o.id || !!o.quickStatusLocked}
                        aria-label="מקום תשלום"
                        title={o.paymentLocationName ?? undefined}
                        onChange={(e) => void onRowPaymentLocationChange(o.id, e.target.value)}
                      >
                        <option value="">—</option>
                        {paymentLocationOptions.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                        {o.paymentLocationId && !paymentLocationLabelById.has(o.paymentLocationId) ? (
                          <option value={o.paymentLocationId}>{o.paymentLocationName ?? "—"}</option>
                        ) : null}
                      </select>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <OrdersListPaginationBar pagination={pagination} label={paginationLabel} />

      <p className="adm-orders-hint">
        {canEditOrders
          ? viewerIsAdmin
            ? "לחיצה על שורה פותחת עריכת הזמנה (חלון)."
            : "לחיצה על שורה פותחת עריכה, או מודל בקשת אישור להזמנות מוכנות/מבוטלות לפי הרשאות."
          : "לחיצה על שורה פותחת את דף ההזמנה."}
      </p>

      <OrderEditLockGateModal
        open={!!lockModal}
        payload={lockModal}
        onClose={() => setLockModal(null)}
        onToast={showToast}
        onAfterRequestSent={() => router.refresh()}
      />
      {toastMsg ? (
        <div className="adm-toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      ) : null}
    </div>
  );
}
