"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { OrdersListToolbar, type OrdersListToolbarProps } from "@/components/admin/OrdersListToolbar";
import { useRouter } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import { OS } from "@/lib/order-status-slugs";
import { useOrderStatusCatalog } from "@/components/admin/OrderStatusCatalogProvider";
import { OrderStatusSelect } from "@/components/admin/OrderStatusSelect";
import {
  CircleCheck,
  CircleX,
  FolderOpen,
  Globe2,
  Hourglass,
  LayoutGrid,
  LockKeyhole,
  Plus,
  CheckSquare,
  type LucideIcon,
} from "lucide-react";
import {
  updateOrderListPaymentLocationAction,
} from "@/app/admin/capture/actions";
import { refreshOrdersListAction, updateOrderCompletedFlagAction } from "@/app/admin/orders/actions";
import { exportOrdersListPdfHtmlAction } from "@/app/admin/orders/export-orders-pdf-action";
import { exportOrdersListExcelCsvAction } from "@/app/admin/orders/export-orders-excel-action";
import { OrdersListExportSplitButton } from "@/components/admin/OrdersListExportSplitButton";
import type { OrdersListExportPreset } from "@/lib/orders-list-export-presets";
import { OrderEditLockGateModal, type OrderEditLockGatePayload } from "@/components/admin/OrderEditLockGateModal";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import {
  ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS,
  orderCaptureSplitMethodLabel,
} from "@/lib/order-capture-payment-methods";
import { orderListRowToneClass } from "@/constants/order-status";
import { useEnsureActiveWorkWeekOnEnter } from "@/hooks/useEnsureActiveWorkWeekOnEnter";
import type { ParsedDateFilter } from "@/lib/work-week";
import { IntakeLocationCombobox } from "@/components/admin/IntakeLocationCombobox";
import { OrdersListPaginationBar } from "@/components/admin/OrdersListPaginationBar";
import {
  formatSignedUsdDisplay,
  isDebtWithdrawalOrderStatus,
} from "@/lib/debt-withdrawal-order";
import { formatMoneyAmount } from "@/lib/money-format";
import {
  orderMatchesStatusKpiFilters,
  toggleStatusKpiFilter,
  type OrderStatusKpiKey,
} from "@/lib/orders-status-kpi-filter";

type CompletedFilter = "not_done" | "done" | "all";

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
  isCompleted: boolean;
  sourceCountry: string | null;
  paymentType: string | null;
  /** מקום תשלום — IntakeLocation / PaymentPoint id (לסינון) */
  paymentLocationId: string | null;
  /** מקום תשלום — שם להצגה */
  paymentLocationName: string | null;
  createdById: string | null;
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
  /** כל ההזמנות בטווח/פילטרים הנוכחיים (ללא סינון ריבועי סטטוס) */
  all: OrdersStatusBucket;
  open: OrdersStatusBucket;
  inProgress: OrdersStatusBucket;
  completed: OrdersStatusBucket;
  cancelled: OrdersStatusBucket;
  debtWithdrawal: OrdersStatusBucket;
  operationalCompleted: OrdersStatusBucket;
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

function OrderStatusKpiButton({
  title,
  toneClass,
  count,
  totalUsd,
  active,
  isAll,
  icon: Icon,
  onClick,
  ariaLabel,
}: {
  title: string;
  toneClass: string;
  count: string;
  totalUsd: string;
  active: boolean;
  isAll?: boolean;
  icon: LucideIcon;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className={[
        "adm-status-card",
        "adm-status-card--erp",
        toneClass,
        isAll ? "adm-status-card--all" : "",
        active ? "adm-status-card--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <span className="adm-status-card__head">
        <Icon className="adm-status-card__icon" size={17} strokeWidth={2.25} aria-hidden />
        <span className="adm-status-card-title">{title}</span>
      </span>
      <strong className="adm-status-card-count">{count}</strong>
      <span className="adm-status-card-amount" dir="ltr">
        ${totalUsd}
      </span>
    </button>
  );
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

function readCompletedFilterFromLocation(): CompletedFilter {
  if (typeof window === "undefined") return "not_done";
  const v = new URLSearchParams(window.location.search).get("ordersCompleted");
  return v === "done" || v === "all" || v === "not_done" ? v : "not_done";
}

function formatOrdersListMoney(
  o: OrderListRow,
  field: "deal" | "total" | "ils",
): { text: string; debtWithdrawal: boolean } {
  const debtWithdrawal = isDebtWithdrawalOrderStatus(o.status);
  if (field === "ils") {
    const raw = parseNumeric(o.totalAmountIls);
    if (raw == null) return { text: "—", debtWithdrawal };
    if (!debtWithdrawal) return { text: o.totalAmountIls ?? "—", debtWithdrawal: false };
    return { text: `-${formatMoneyAmount(Math.abs(raw))}`, debtWithdrawal: true };
  }
  const rawStr = field === "deal" ? o.dealAmountUsd : o.totalAmountUsd;
  const raw = parseNumeric(rawStr);
  if (raw == null) return { text: "—", debtWithdrawal };
  if (!debtWithdrawal) return { text: rawStr ?? "—", debtWithdrawal: false };
  return { text: `$${formatSignedUsdDisplay(-Math.abs(raw))}`, debtWithdrawal: true };
}

function signedExportMoney(o: OrderListRow, field: "deal" | "total" | "ils"): string {
  const { text } = formatOrdersListMoney(o, field);
  return text === "—" ? "" : text;
}

function orderEditBadgeLabel(
  b: NonNullable<OrderListRow["editBadge"]>,
  orderStatus: string,
): { tone: "pending" | "unlock" | "rejected" | "locked" | ""; text: string; cls: string } {
  const isCancelled = orderStatus === OS.CANCELLED;
  switch (b) {
    case "pending":
      return { tone: "pending", text: "ממתין לאישור עדכון", cls: "adm-order-edit-badge--pending" };
    case "unlock":
      return { tone: "unlock", text: "מאושר", cls: "adm-order-edit-badge--unlock" };
    case "rejected":
      return { tone: "rejected", text: "נדחה", cls: "adm-order-edit-badge--rejected" };
    case "locked":
      return isCancelled
        ? {
            tone: "locked",
            text: "הזמנה נעולה — ממתין לאישור מנהל",
            cls: "adm-order-edit-badge adm-order-edit-badge--locked-cancelled",
          }
        : {
            tone: "locked",
            text: "הזמנה נעולה — ממתין לאישור מנהל",
            cls: "adm-order-edit-badge adm-order-edit-badge--locked-ready",
          };
    default:
      return { tone: "", text: "", cls: "" };
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
  toolbarProps: OrdersListToolbarProps;
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
  toolbarProps,
}: Props) {
  useEnsureActiveWorkWeekOnEnter("orders");
  const router = useRouter();
  const { openWindow } = useAdminWindows();
  useOrderStatusCatalog();
  const [rows, setRows] = useState<OrderListRow[]>(orders);
  const [statusSummaryLive, setStatusSummaryLive] = useState(statusSummary);
  const [paginationLive, setPaginationLive] = useState(pagination);
  const [filterOptionsLive, setFilterOptionsLive] = useState({
    createdByOptions: toolbarProps.createdByOptions,
    paymentLocationOptions,
  });
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [lockModal, setLockModal] = useState<OrderEditLockGatePayload | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>(() => readCompletedFilterFromLocation());
  const [activeStatusFilters, setActiveStatusFilters] = useState<OrderStatusKpiKey[]>([]);
  const [extraPaymentLocationOptions, setExtraPaymentLocationOptions] = useState<
    { id: string; label: string }[]
  >([]);
  const toggleStatusFilter = useCallback((key: OrderStatusKpiKey) => {
    setActiveStatusFilters((prev) => toggleStatusKpiFilter(prev, key));
  }, []);

  const clearStatusKpiFilters = useCallback(() => {
    setActiveStatusFilters([]);
  }, []);

  const statusKpiAllActive = activeStatusFilters.length === 0;

  const mergedPaymentLocationOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of filterOptionsLive.paymentLocationOptions) m.set(p.id, p.label);
    for (const p of extraPaymentLocationOptions) m.set(p.id, p.label);
    return [...m.entries()].map(([id, label]) => ({ id, label }));
  }, [filterOptionsLive.paymentLocationOptions, extraPaymentLocationOptions]);

  const paymentLocationLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of mergedPaymentLocationOptions) m.set(p.id, p.label);
    return m;
  }, [mergedPaymentLocationOptions]);

  const tableRows = useMemo(
    () => rows.filter((o) => orderMatchesStatusKpiFilters(o.status, activeStatusFilters)),
    [rows, activeStatusFilters],
  );

  const statusKpiCards = useMemo(
    () =>
      [
        {
          key: "open" as const,
          tone: "adm-status-card--open",
          title: "פתוחות",
          icon: FolderOpen,
          bucket: statusSummaryLive.open,
        },
        {
          key: "completed" as const,
          tone: "adm-status-card--completed",
          title: "מוכנות",
          icon: CircleCheck,
          bucket: statusSummaryLive.completed,
        },
        {
          key: "cancelled" as const,
          tone: "adm-status-card--cancelled",
          title: "מבוטלות",
          icon: CircleX,
          bucket: statusSummaryLive.cancelled,
        },
        {
          key: "inProgress" as const,
          tone: "adm-status-card--progress",
          title: "בטיפול",
          icon: Hourglass,
          bucket: statusSummaryLive.inProgress,
        },
        {
          key: "debtWithdrawal" as const,
          tone: "adm-status-card--withdrawal",
          title: "משיכה מחו״ב",
          icon: Globe2,
          bucket: statusSummaryLive.debtWithdrawal,
        },
        {
          key: "operationalCompleted" as const,
          tone: "adm-status-card--operational-completed",
          title: "הושלמו",
          icon: CheckSquare,
          bucket: statusSummaryLive.operationalCompleted,
        },
      ] satisfies {
        key: OrderStatusKpiKey | "operationalCompleted";
        tone: string;
        title: string;
        icon: LucideIcon;
        bucket: OrdersStatusBucket;
      }[],
    [statusSummaryLive],
  );

  const paginationLabel = useMemo(() => {
    const { page, pageSize, totalCount } = paginationLive;
    if (totalCount === 0) return "אין הזמנות בתצוגה";
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, totalCount);
    const base = `מציג ${from.toLocaleString("he-IL")}–${to.toLocaleString("he-IL")} מתוך ${totalCount.toLocaleString("he-IL")}`;
    if (activeStatusFilters.length === 0) return base;
    return `${base} · ${tableRows.length.toLocaleString("he-IL")} לאחר סינון ריבועים בעמוד`;
  }, [paginationLive, activeStatusFilters.length, tableRows.length]);

  useEffect(() => {
    setRows(orders);
    setStatusSummaryLive(statusSummary);
    setPaginationLive(pagination);
    setFilterOptionsLive({
      createdByOptions: toolbarProps.createdByOptions,
      paymentLocationOptions,
    });
  }, [orders, statusSummary, pagination, toolbarProps.createdByOptions, paymentLocationOptions]);

  const readExportSearchParams = useCallback((): Record<string, string | string[] | undefined> => {
    const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const raw: Record<string, string | string[] | undefined> = {};
    sp.forEach((v, k) => {
      raw[k] = v;
    });
    return raw;
  }, []);

  const setCompletedFilterInUrl = useCallback(
    (next: CompletedFilter) => {
      setCompletedFilter(next);
      const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      if (next === "not_done") sp.delete("ordersCompleted");
      else sp.set("ordersCompleted", next);
      sp.delete("page");
      const q = sp.toString();
      router.replace(q ? `/admin/orders?${q}` : "/admin/orders", { scroll: false });
    },
    [router],
  );

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

  const refreshList = useCallback(async () => {
    if (refreshLoading) return;
    setRefreshLoading(true);
    setListErr(null);
    try {
      const data = await refreshOrdersListAction(readExportSearchParams());
      setRows(data.orders);
      setStatusSummaryLive(data.statusSummary);
      setPaginationLive(data.pagination);
      setFilterOptionsLive({
        createdByOptions: data.createdByOptions,
        paymentLocationOptions: data.paymentLocationOptions,
      });
      showToast("הנתונים עודכנו");
    } catch {
      setListErr("שגיאה ברענון הרשימה");
    } finally {
      setRefreshLoading(false);
    }
  }, [refreshLoading, readExportSearchParams, showToast]);

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

  const onRowStatusChange = useCallback(async (orderId: string, next: string) => {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const t0 = now();
    let statusUpdateDbMs = 0;
    let statusUpdateUiMs = 0;
    /** אין router.refresh / refetch רשימה / KPI — רק optimistic לשורה */
    const statusRefreshMs = 0;
    setListErr(null);
    let prevSnapshot: OrderListRow[] = [];
    const uiT0 = now();
    setRows((cur) => {
      prevSnapshot = cur;
      return cur.map((r) =>
        r.id === orderId
          ? { ...r, status: next, ...(next !== OS.COMPLETED ? { isCompleted: false } : {}) }
          : r,
      );
    });
    statusUpdateUiMs += now() - uiT0;
    setBusyId(orderId);
    const dbT0 = now();
    const res = await fetch("/api/orders/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ orderId, status: next }),
    })
      .then(async (r) => ((await r.json().catch(() => null)) as { ok: boolean; error?: string; debtWithdrawalUsd?: number }) ?? { ok: false, error: "שגיאה" })
      .catch(() => ({ ok: false, error: "שגיאה בשמירה" }));
    statusUpdateDbMs += now() - dbT0;
    setBusyId(null);
    if (!res.ok) {
      const uiRollbackT0 = now();
      setRows(prevSnapshot);
      statusUpdateUiMs += now() - uiRollbackT0;
      setListErr(res.error ?? "שגיאה בשמירה");
      const totalMs = Math.round(now() - t0);
      if (process.env.NODE_ENV === "development" || totalMs > 300) {
        console.table({
          statusUpdateDbMs: Math.round(statusUpdateDbMs),
          statusUpdateUiMs: Math.round(statusUpdateUiMs),
          statusRefreshMs,
          totalMs,
        });
      }
      return;
    }
    if (next === OS.DEBT_WITHDRAWAL && "debtWithdrawalUsd" in res && typeof res.debtWithdrawalUsd === "number") {
      const withdrawn = res.debtWithdrawalUsd;
      const uiDwT0 = now();
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
      statusUpdateUiMs += now() - uiDwT0;
    }

    const totalMs = Math.round(now() - t0);
    if (process.env.NODE_ENV === "development" || totalMs > 300) {
      console.table({
        statusUpdateDbMs: Math.round(statusUpdateDbMs),
        statusUpdateUiMs: Math.round(statusUpdateUiMs),
        statusRefreshMs,
        totalMs,
      });
    }
  }, []);

  const onRowCompletedChange = useCallback(
    async (orderId: string, next: boolean) => {
      const row = rows.find((r) => r.id === orderId);
      if (!row) return;
      if (row.status !== OS.COMPLETED) {
        setListErr("אפשר לסמן הושלם רק להזמנה במצב מוכן");
        return;
      }
      setListErr(null);
      const prevSnapshot = rows;
      setRows((cur) =>
        cur
          .map((r) => (r.id === orderId ? { ...r, isCompleted: next } : r))
          .filter((r) => {
            if (completedFilter === "all") return true;
            if (completedFilter === "done") return r.isCompleted;
            return !r.isCompleted;
          }),
      );
      setBusyId(orderId);
      const res = await updateOrderCompletedFlagAction(orderId, next);
      setBusyId(null);
      if (!res.ok) {
        setRows(prevSnapshot);
        setListErr(res.error);
      } else {
        showToast(next ? "ההזמנה סומנה כהושלמה" : "סימון הושלם בוטל");
      }
    },
    [rows, completedFilter, showToast],
  );

  const onRowPaymentMethodChange = useCallback(
    async (orderId: string, raw: string) => {
      const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
      const t0 = now();
      let paymentMethodUpdateMs = 0;
      let tableRefreshMs = 0;
      let kpiRefreshMs = 0;
      let renderMs = 0;
      setListErr(null);
      const next = raw ? (raw as PaymentMethod) : null;
      const prevSnapshot = rows;
      const uiT0 = now();
      setRows((cur) => cur.map((r) => (r.id === orderId ? { ...r, paymentType: next } : r)));
      renderMs += now() - uiT0;
      setBusyId(orderId);
      const reqT0 = now();
      const res = await fetch("/api/orders/payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ orderId, paymentMethod: next }),
      })
        .then(async (r) => ((await r.json().catch(() => null)) as any) ?? { ok: false, error: "שגיאה" })
        .catch(() => ({ ok: false, error: "שגיאה בשמירה" }));
      paymentMethodUpdateMs += now() - reqT0;
      setBusyId(null);
      if (!res.ok) {
        const uiRollbackT0 = now();
        setRows(prevSnapshot);
        renderMs += now() - uiRollbackT0;
        setListErr(res.error);
        const totalMs = Math.round(now() - t0);
        if (process.env.NODE_ENV === "development" || totalMs > 500) {
          console.table({
            paymentMethodUpdateMs: Math.round(paymentMethodUpdateMs),
            tableRefreshMs: Math.round(tableRefreshMs),
            kpiRefreshMs: Math.round(kpiRefreshMs),
            renderMs: Math.round(renderMs),
            totalMs,
          });
        }
        return;
      }

      requestAnimationFrame(() => {
        const totalMs = Math.round(now() - t0);
        if (process.env.NODE_ENV === "development" || totalMs > 500) {
          console.table({
            paymentMethodUpdateMs: Math.round(paymentMethodUpdateMs),
            tableRefreshMs: Math.round(tableRefreshMs),
            kpiRefreshMs: Math.round(kpiRefreshMs),
            renderMs: Math.round(renderMs),
            totalMs,
          });
        }
      });
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

  const downloadCsv = useCallback(
    (csv: string, suffix: string) => {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportFilenameBase}_${suffix}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [exportFilenameBase],
  );

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
    async (preset: OrdersListExportPreset) => {
      setListErr(null);
      setPdfLoading(true);
      try {
        const res = await exportOrdersListPdfHtmlAction(
          readExportSearchParams(),
          preset,
          activeStatusFilters,
        );
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
    [printOrdersPdfHtml, readExportSearchParams, activeStatusFilters],
  );

  const runExcelExport = useCallback(
    async (preset: OrdersListExportPreset) => {
      setListErr(null);
      setExcelLoading(true);
      try {
        const res = await exportOrdersListExcelCsvAction(
          readExportSearchParams(),
          preset,
          activeStatusFilters,
        );
        if (!res.ok) {
          setListErr(res.error);
          return;
        }
        downloadCsv(res.csv, res.filenameHint);
      } catch {
        setListErr("לא ניתן להפיק Excel — אנא נסו שוב.");
      } finally {
        setExcelLoading(false);
      }
    },
    [downloadCsv, readExportSearchParams, activeStatusFilters],
  );

  const toolbarPropsLive = useMemo(
    () => ({
      ...toolbarProps,
      createdByOptions: filterOptionsLive.createdByOptions,
      paymentLocationOptions: filterOptionsLive.paymentLocationOptions,
    }),
    [toolbarProps, filterOptionsLive],
  );

  const createdByOptionsMerged = useMemo(() => {
    const map = new Map<string, string>();
    for (const opt of toolbarPropsLive.createdByOptions) {
      map.set(opt.id, opt.label);
    }
    for (const o of orders) {
      if (o.createdById) {
        map.set(o.createdById, o.createdByName?.trim() || o.createdById);
      }
    }
    if (toolbarPropsLive.createdById && !map.has(toolbarPropsLive.createdById)) {
      map.set(toolbarPropsLive.createdById, "עובד נבחר");
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "he"));
  }, [orders, toolbarPropsLive.createdById, toolbarPropsLive.createdByOptions]);

  const filterLeadingActions = (
    <>
      {canCreateOrders ? (
        <button
          type="button"
          className="adm-btn adm-btn--primary adm-btn--dense adm-orders-top-btn adm-orders-top-btn--new"
          onClick={newOrder}
        >
          <Plus size={15} strokeWidth={2.2} aria-hidden />
          הזמנה חדשה
        </button>
      ) : null}
      <label className="adm-orders-completed-filter">
        <span>הושלם</span>
        <select
          value={completedFilter}
          onChange={(e) => setCompletedFilterInUrl(e.target.value as CompletedFilter)}
          aria-label="סינון הושלם"
        >
          <option value="all">הכל</option>
          <option value="not_done">לא הושלם</option>
          <option value="done">הושלם</option>
        </select>
      </label>
      <button
        type="button"
        className="adm-orders-btn adm-orders-btn--refresh"
        onClick={() => void refreshList()}
        disabled={refreshLoading}
        title="רענון רשימה"
        aria-busy={refreshLoading}
      >
        {refreshLoading ? (
          <span className="payment-modal-save-spinner adm-orders-refresh-spinner" aria-hidden />
        ) : null}
        רענון
      </button>
    </>
  );

  const kpiExportActions = (
    <div className="adm-orders-kpi-export-actions" role="group" aria-label="ייצוא רשימה">
      <OrdersListExportSplitButton
        variant="pdf"
        disabled={pdfLoading}
        onQuickExport={() => void runPdfExport("screen_filter")}
        onSelect={(preset) => void runPdfExport(preset)}
      />
      <OrdersListExportSplitButton
        variant="excel"
        disabled={excelLoading}
        onQuickExport={() => void runExcelExport("screen_filter")}
        onSelect={(preset) => void runExcelExport(preset)}
      />
    </div>
  );

  return (
    <div className="adm-orders-work">
      <div className="adm-orders-filters-row">
        <Suspense fallback={<div className="adm-orders-toolbar-skel" aria-hidden />}>
          <OrdersListToolbar
            key={`${toolbarPropsLive.ahWeekSelect}|${toolbarPropsLive.fromYmd}|${toolbarPropsLive.toYmd}`}
            {...toolbarPropsLive}
            createdByOptions={createdByOptionsMerged}
            leadingActions={filterLeadingActions}
            exportActions={kpiExportActions}
          />
        </Suspense>
      </div>

      <div className="adm-orders-main-panel" dir="rtl">
        <div className="adm-orders-action-kpi-row">
          <div
            className="adm-orders-status-kpi adm-orders-status-kpi--board"
            aria-label="סיכומים לפי סטטוס — לחיצה מסננת את הטבלה"
          >
            <OrderStatusKpiButton
              title="הכל"
              toneClass="adm-status-card--all"
              count={statusSummaryLive.all.count}
              totalUsd={statusSummaryLive.all.totalUsd}
              active={statusKpiAllActive}
              isAll
              icon={LayoutGrid}
              onClick={clearStatusKpiFilters}
              ariaLabel={`הכל — ${statusKpiAllActive ? "מציג את כל ההזמנות" : "לחיצה לאיפוס סינון סטטוס והצגת כל ההזמנות"}`}
            />
            {statusKpiCards.map((card) => {
              const operational = card.key === "operationalCompleted";
              const active = !operational && activeStatusFilters.includes(card.key);
              return (
                <OrderStatusKpiButton
                  key={card.key}
                  title={card.title}
                  toneClass={card.tone}
                  count={card.bucket.count}
                  totalUsd={card.bucket.totalUsd}
                  active={active}
                  icon={card.icon}
                  onClick={() => {
                    if (operational) setCompletedFilterInUrl("done");
                    else toggleStatusFilter(card.key);
                  }}
                  ariaLabel={
                    operational
                      ? "הושלמו — לחיצה להצגת הזמנות שסומנו הושלם"
                      : `${card.title} — ${active ? "סינון פעיל, לחיצה לביטול" : "לחיצה לסינון לפי סטטוס זה"}`
                  }
                />
              );
            })}
          </div>
        </div>

        {listErr ? (
          <p className="adm-orders-inline-err" role="alert">
            {listErr}
          </p>
        ) : null}

        <div className="adm-orders-table-host mobile-table-wrapper adm-table-excel-wrap adm-table-excel-wrap--orders">
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
              <th className="adm-ord-col-completed">הושלם</th>
              <th className="adm-ord-col-meta adm-ord-col-pay">צורת תשלום</th>
              <th className="adm-ord-col-meta adm-ord-col-payloc">מקום תשלום</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 ? (
              <tr>
                <td colSpan={12} className="adm-table-empty">
                  {rows.length === 0
                    ? "אין הזמנות בטווח הנבחר."
                    : "אין הזמנות בעמוד הנוכחי לפי ריבועי הסטטוס שנבחרו."}
                </td>
              </tr>
            ) : (
              tableRows.map((o) => {
                const selVal = o.status?.trim() ? o.status : OS.OPEN;
                const editBadgeUi = o.editBadge ? orderEditBadgeLabel(o.editBadge, o.status) : null;
                return (
                  <tr
                    key={o.id}
                    className={`adm-table-excel-row ${orderListRowToneClass(o.status)}`}
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
                            {editBadgeUi.tone === "locked" ? (
                              <LockKeyhole size={13} strokeWidth={1.75} aria-hidden />
                            ) : (
                              <span className={`adm-order-edit-badge-dot adm-order-edit-badge-dot--${editBadgeUi.tone}`} aria-hidden />
                            )}
                            {editBadgeUi.text}
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
                      className={[
                        "adm-table-excel-money",
                        "adm-table-excel-money--usd",
                        "adm-ord-col-money",
                        "adm-ord-col-money--deal",
                        formatOrdersListMoney(o, "deal").debtWithdrawal ? "adm-ord-money--debt-withdrawal" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      title={
                        o.commissionAmountUsd ? `עמלה: ${o.commissionAmountUsd}` : undefined
                      }
                    >
                      {formatOrdersListMoney(o, "deal").text}
                    </td>
                    <td
                      dir="ltr"
                      className={[
                        "adm-table-excel-money",
                        "adm-table-excel-money--usd",
                        "adm-table-excel-money--strong",
                        "adm-ord-col-money",
                        "adm-ord-col-money--total",
                        formatOrdersListMoney(o, "total").debtWithdrawal ? "adm-ord-money--debt-withdrawal" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      title={
                        o.commissionAmountUsd ? `כולל עמלה: ${o.commissionAmountUsd}` : undefined
                      }
                    >
                      {formatOrdersListMoney(o, "total").text}
                    </td>
                    <td
                      dir="ltr"
                      className={[
                        "adm-table-excel-money",
                        "adm-table-excel-money--ils",
                        "adm-ord-col-ils",
                        formatOrdersListMoney(o, "ils").debtWithdrawal ? "adm-ord-money--debt-withdrawal" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {formatOrdersListMoney(o, "ils").text}
                    </td>
                    <td className="adm-table-excel-status-cell adm-ord-col-status" onClick={(e) => e.stopPropagation()}>
                      <OrderStatusSelect
                        variant="table"
                        className="adm-table-status-sel"
                        value={selVal}
                        includeCurrentValue
                        disabled={!canEditOrders || busyId === o.id || !!o.quickStatusLocked}
                        aria-label="סטטוס הזמנה"
                        onChange={(v) => void onRowStatusChange(o.id, v)}
                      />
                    </td>
                    <td className="adm-ord-col-completed" onClick={(e) => e.stopPropagation()}>
                      <label
                        className={[
                          "adm-order-completed-check",
                          o.isCompleted ? "adm-order-completed-check--done" : "",
                          o.status !== OS.COMPLETED || !viewerIsAdmin ? "adm-order-completed-check--disabled" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        title={
                          o.status !== OS.COMPLETED
                            ? "ניתן לסמן הושלם רק כשההזמנה מוכנה"
                            : !viewerIsAdmin
                              ? "קריאה בלבד"
                              : o.isCompleted
                                ? "בטל הושלם"
                                : "סמן הושלם"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={o.isCompleted}
                          disabled={o.status !== OS.COMPLETED || !viewerIsAdmin || busyId === o.id}
                          onChange={(e) => void onRowCompletedChange(o.id, e.target.checked)}
                          aria-label="הושלם"
                        />
                        <span aria-hidden>{o.isCompleted ? "✅" : "⬜"}</span>
                      </label>
                    </td>
                    <td className="adm-ord-col-meta adm-ord-col-pay" onClick={(e) => e.stopPropagation()}>
                      <select
                        className="adm-pay-sel adm-pay-sel--neutral"
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
                      <IntakeLocationCombobox
                        variant="table"
                        value={o.paymentLocationId ?? ""}
                        label={o.paymentLocationName ?? paymentLocationLabelById.get(o.paymentLocationId ?? "") ?? ""}
                        disabled={!canEditOrders || busyId === o.id || !!o.quickStatusLocked}
                        onChange={(id, label) => {
                          if (id && !paymentLocationLabelById.has(id)) {
                            setExtraPaymentLocationOptions((prev) => {
                              if (prev.some((p) => p.id === id)) return prev;
                              return [...prev, { id, label }];
                            });
                          }
                          void onRowPaymentLocationChange(o.id, id);
                        }}
                        onOptionCreated={(opt) => {
                          setExtraPaymentLocationOptions((prev) => {
                            if (prev.some((p) => p.id === opt.id)) return prev;
                            return [...prev, opt];
                          });
                        }}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

        <OrdersListPaginationBar pagination={paginationLive} label={paginationLabel} />

        <p className="adm-orders-hint">
          {canEditOrders
            ? viewerIsAdmin
              ? "לחיצה על שורה פותחת עריכת הזמנה (חלון)."
              : "לחיצה על שורה פותחת עריכה, או מודל בקשת אישור להזמנות מוכנות/מבוטלות לפי הרשאות."
            : "לחיצה על שורה פותחת את דף ההזמנה."}
        </p>
      </div>

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
