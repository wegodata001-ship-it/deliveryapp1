"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PaymentMethod } from "@prisma/client";
import {
  captureOrderAction,
  getOrderForWorkPanelAction,
  previewOrderNumberAction,
  searchCustomersForOrderAction,
  updateOrderWorkPanelAction,
  type CustomerSearchRow,
} from "@/app/admin/capture/actions";
import { previewOrderIlsSummary } from "@/lib/order-capture-preview";
import { withQuery } from "@/lib/admin-url-query";
import { DEFAULT_WEEK_CODE, WORK_WEEK_CODES_SORTED, WORK_WEEK_RANGES, formatLocalYmd } from "@/lib/work-week";
import type { SerializedFinancial } from "@/lib/financial-settings";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CUSTOMER_TYPES = ["רגיל", "סיטונאי", "סוכן", "מוסדי"] as const;

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  POINT: "נקודה",
  BANK_TRANSFER: "העברה בנקאית",
  BANK_TRANSFER_DONE: "העברה בוצעה",
  ORDERED: "הוזמן",
  WITHDRAWAL: "משיכה",
  WITHDRAWAL_DONE: "משיכה בוצעה",
  RECEIVED_AT_POINT: "התקבל בנקודה",
  WITH_GOODS: "עם סחורה",
  CHECK: "צ׳ק",
  CASH: "מזומן",
  OTHER: "אחר",
};

type PanelTarget =
  | { visible: false }
  | { visible: true; mode: "create" }
  | { visible: true; mode: "edit"; orderId: string };

function resolveOrderWorkPanelTarget(
  pathname: string,
  orderWork: string | null,
  canCreateOrders: boolean,
  canEditOrders: boolean,
): PanelTarget {
  if (!(canCreateOrders || canEditOrders)) return { visible: false };
  const onOrders = pathname === "/admin/orders" || pathname.startsWith("/admin/orders/");

  if (onOrders) {
    if (!orderWork || orderWork === "new") {
      return canCreateOrders ? { visible: true, mode: "create" } : { visible: false };
    }
    if (UUID_RE.test(orderWork) && canEditOrders) {
      return { visible: true, mode: "edit", orderId: orderWork };
    }
    return canCreateOrders ? { visible: true, mode: "create" } : { visible: false };
  }

  if (orderWork === "new" && canCreateOrders) return { visible: true, mode: "create" };
  if (orderWork && UUID_RE.test(orderWork) && canEditOrders) {
    return { visible: true, mode: "edit", orderId: orderWork };
  }
  return { visible: false };
}

function panelTargetKey(t: PanelTarget): string {
  if (!t.visible) return "hidden";
  if (t.mode === "create") return "create";
  return `edit:${t.orderId}`;
}

type Props = {
  financial: SerializedFinancial | null;
  onToast: (msg: string) => void;
  canCreateOrders: boolean;
  canEditOrders: boolean;
};

function parseNum(s: string): number {
  const t = s.replace(",", ".").trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function resetCreateForm(
  setWeekCode: (v: string) => void,
  setOrderDateYmd: (v: string) => void,
  setOrderNumberPreview: (v: string) => void,
  setCustomerQuery: (v: string) => void,
  setCustomerHits: (v: CustomerSearchRow[]) => void,
  setCustomerOpen: (v: boolean) => void,
  setSelectedCustomer: (v: CustomerSearchRow | null) => void,
  setCustomerType: (v: string) => void,
  setDealUsd: (v: string) => void,
  setCommissionMode: (v: "USD" | "PERCENT") => void,
  setCommissionValue: (v: string) => void,
  setPaymentMethod: (v: PaymentMethod) => void,
  setNotes: (v: string) => void,
  setErr: (v: string | null) => void,
  setEditOrderId: (v: string | null) => void,
  loadPreviewNumber: (wc: string) => void,
) {
  setWeekCode(DEFAULT_WEEK_CODE);
  setOrderDateYmd(formatLocalYmd(new Date()));
  setCustomerQuery("");
  setCustomerHits([]);
  setCustomerOpen(false);
  setSelectedCustomer(null);
  setCustomerType(CUSTOMER_TYPES[0]);
  setDealUsd("");
  setCommissionMode("USD");
  setCommissionValue("");
  setPaymentMethod(PaymentMethod.BANK_TRANSFER);
  setNotes("");
  setErr(null);
  setEditOrderId(null);
  void loadPreviewNumber(DEFAULT_WEEK_CODE);
}

export function OrderWorkPanel({ financial, onToast, canCreateOrders, canEditOrders }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const orderWorkRaw = sp.get("orderWork");

  const { target, panelKey } = useMemo(() => {
    const t = resolveOrderWorkPanelTarget(pathname, orderWorkRaw, canCreateOrders, canEditOrders);
    return { target: t, panelKey: panelTargetKey(t) };
  }, [pathname, orderWorkRaw, canCreateOrders, canEditOrders]);

  const onOrdersPage = pathname === "/admin/orders" || pathname.startsWith("/admin/orders/");
  const showDismiss = target.visible && !onOrdersPage;

  const [weekCode, setWeekCode] = useState(DEFAULT_WEEK_CODE);
  const [orderDateYmd, setOrderDateYmd] = useState(formatLocalYmd(new Date()));
  const [orderNumberPreview, setOrderNumberPreview] = useState("");

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerHits, setCustomerHits] = useState<CustomerSearchRow[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchRow | null>(null);
  const [customerType, setCustomerType] = useState<string>(CUSTOMER_TYPES[0]);

  const [dealUsd, setDealUsd] = useState("");
  const [commissionMode, setCommissionMode] = useState<"USD" | "PERCENT">("USD");
  const [commissionValue, setCommissionValue] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.BANK_TRANSFER);

  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadOrderBusy, setLoadOrderBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);

  const finalRate = useMemo(() => {
    const f = financial?.finalDollarRate ? Number(financial.finalDollarRate.replace(",", ".")) : NaN;
    return Number.isFinite(f) && f > 0 ? f : 3.5;
  }, [financial]);

  const customerTypeOptions = useMemo(() => {
    const base: string[] = [...CUSTOMER_TYPES];
    const t = selectedCustomer?.customerType?.trim();
    if (t && !base.includes(t)) base.push(t);
    return base;
  }, [selectedCustomer]);

  const ilsPreview = useMemo(() => {
    const deal = parseNum(dealUsd);
    const raw = parseNum(commissionValue);
    let commission = 0;
    if (Number.isFinite(raw) && raw > 0) {
      if (commissionMode === "PERCENT" && Number.isFinite(deal)) {
        commission = (deal * raw) / 100;
      } else if (commissionMode === "USD") {
        commission = raw;
      }
    }
    if (!Number.isFinite(deal) || deal <= 0) return null;
    return previewOrderIlsSummary(deal, commission, finalRate, 18);
  }, [dealUsd, commissionValue, commissionMode, finalRate]);

  const loadPreviewNumber = useCallback(async (wc: string) => {
    try {
      const n = await previewOrderNumberAction(wc);
      setOrderNumberPreview(n || "—");
    } catch {
      setOrderNumberPreview("—");
    }
  }, []);

  const applyLoadedOrder = useCallback((p: Awaited<ReturnType<typeof getOrderForWorkPanelAction>>) => {
    if (!p) return;
    setEditOrderId(p.id);
    setWeekCode(p.weekCode in WORK_WEEK_RANGES ? p.weekCode : DEFAULT_WEEK_CODE);
    setOrderDateYmd(p.orderDateYmd);
    setOrderNumberPreview(p.orderNumber);
    setCustomerQuery(p.customerLabel);
    setSelectedCustomer({
      id: p.customerId,
      label: p.customerLabel,
      code: p.customerCode,
      customerType: p.customerType,
      city: null,
    });
    setCustomerType(p.customerType);
    setDealUsd(p.dealUsd);
    setCommissionMode("USD");
    setCommissionValue(p.commissionUsd);
    setPaymentMethod(p.paymentMethod);
    setNotes(p.notes);
    setErr(null);
  }, []);

  useEffect(() => {
    if (panelKey === "hidden") return;

    if (panelKey === "create") {
      resetCreateForm(
        setWeekCode,
        setOrderDateYmd,
        setOrderNumberPreview,
        setCustomerQuery,
        setCustomerHits,
        setCustomerOpen,
        setSelectedCustomer,
        setCustomerType,
        setDealUsd,
        setCommissionMode,
        setCommissionValue,
        setPaymentMethod,
        setNotes,
        setErr,
        setEditOrderId,
        loadPreviewNumber,
      );
      return;
    }

    const orderId = panelKey.startsWith("edit:") ? panelKey.slice(5) : "";
    if (!orderId) return;

    let cancelled = false;
    (async () => {
      setLoadOrderBusy(true);
      setErr(null);
      const row = await getOrderForWorkPanelAction(orderId);
      if (cancelled) return;
      if (!row) {
        setErr("לא ניתן לטעון את ההזמנה");
        setLoadOrderBusy(false);
        return;
      }
      applyLoadedOrder(row);
      setLoadOrderBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [panelKey, applyLoadedOrder, loadPreviewNumber]);

  useEffect(() => {
    if (panelKey !== "create") return;
    void loadPreviewNumber(weekCode);
  }, [weekCode, panelKey, loadPreviewNumber]);

  useEffect(() => {
    if (panelKey === "hidden" || !customerOpen) return;
    const t = window.setTimeout(() => {
      void searchCustomersForOrderAction(customerQuery).then(setCustomerHits);
    }, 280);
    return () => window.clearTimeout(t);
  }, [customerQuery, customerOpen, panelKey]);

  function pickCustomer(row: CustomerSearchRow) {
    setSelectedCustomer(row);
    setCustomerQuery(row.label);
    const ty = row.customerType?.trim();
    if (ty) setCustomerType(ty);
    else setCustomerType(CUSTOMER_TYPES[0]);
    setCustomerOpen(false);
  }

  function dismissPanel() {
    router.replace(withQuery(pathname, sp, { orderWork: null }));
  }

  function cancelForm() {
    if (onOrdersPage) {
      router.replace(withQuery(pathname, sp, { orderWork: null }));
    } else {
      dismissPanel();
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer) {
      setErr("יש לבחור לקוח מהרשימה");
      return;
    }

    const isEdit = panelKey.startsWith("edit:");
    if (isEdit) {
      if (!editOrderId || !canEditOrders) {
        setErr("אין הרשאה לעריכה");
        return;
      }
      setBusy(true);
      setErr(null);
      const res = await updateOrderWorkPanelAction({
        orderId: editOrderId,
        weekCode,
        orderDateYmd,
        customerId: selectedCustomer.id,
        customerTypeSnapshot: customerType,
        dealUsd,
        commissionMode,
        commissionValue,
        paymentMethod,
        notes,
      });
      setBusy(false);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onToast("הזמנה עודכנה");
      router.refresh();
      return;
    }

    if (!canCreateOrders) {
      setErr("אין הרשאה ליצירת הזמנה");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await captureOrderAction({
      weekCode,
      orderDateYmd,
      customerId: selectedCustomer.id,
      customerTypeSnapshot: customerType,
      dealUsd,
      commissionMode,
      commissionValue,
      paymentMethod,
      notes,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    onToast("הזמנה נקלטה");
    router.refresh();
    if (onOrdersPage) {
      router.replace(withQuery(pathname, sp, { orderWork: null }));
    } else {
      dismissPanel();
    }
  }

  const fmtIls = (n: number) =>
    new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 }).format(n);

  if (!target.visible) return null;

  const title = panelKey === "create" ? "הזמנה חדשה" : "עריכת הזמנה";

  return (
    <aside className="adm-order-work-panel" aria-label="פאנל הזמנה">
      <header className="adm-order-work-panel-head">
        <h2 className="adm-order-work-panel-title">{title}</h2>
        {showDismiss ? (
          <button type="button" className="adm-order-work-panel-close" onClick={dismissPanel} aria-label="סגירת פאנל">
            ×
          </button>
        ) : null}
      </header>

      {loadOrderBusy ? (
        <p className="adm-order-work-panel-loading">טוען…</p>
      ) : (
        <form className="adm-order-work-panel-form" onSubmit={onSubmit}>
          {err ? <div className="adm-error adm-error--compact">{err}</div> : null}

          <div className="adm-capture-dense-grid">
            <div className="adm-field">
              <label htmlFor="ow-week">שבוע עבודה</label>
              <select
                id="ow-week"
                value={weekCode}
                disabled={busy}
                onChange={(e) => {
                  const code = e.target.value;
                  setWeekCode(code);
                  const r = WORK_WEEK_RANGES[code];
                  if (r) setOrderDateYmd(r.from);
                }}
              >
                {WORK_WEEK_CODES_SORTED.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="ow-date">תאריך הזמנה</label>
              <input
                id="ow-date"
                type="date"
                required
                disabled={busy}
                value={orderDateYmd}
                onChange={(e) => setOrderDateYmd(e.target.value)}
              />
            </div>

            <div className="adm-field">
              <label htmlFor="ow-ordnum">מספר הזמנה</label>
              <input
                id="ow-ordnum"
                type="text"
                readOnly
                className="adm-input-readonly adm-input-readonly--dense"
                value={orderNumberPreview || "…"}
                dir="ltr"
                title={panelKey === "create" ? "נוצר בשמירה — תצוגה משוערת" : undefined}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="ow-cust-type">סוג לקוח</label>
              <select id="ow-cust-type" value={customerType} disabled={busy} onChange={(e) => setCustomerType(e.target.value)}>
                {customerTypeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="adm-field adm-field-span-2">
              <label htmlFor="ow-cust-q">לקוח</label>
              <div className="adm-combo adm-combo--dense">
                <input
                  id="ow-cust-q"
                  type="text"
                  autoComplete="off"
                  placeholder="חיפוש: שם, קוד, טלפון…"
                  disabled={busy}
                  value={customerQuery}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomerQuery(v);
                    setCustomerOpen(true);
                    if (!v.trim()) {
                      setSelectedCustomer(null);
                      setCustomerType(CUSTOMER_TYPES[0]);
                    }
                  }}
                  onFocus={() => setCustomerOpen(true)}
                  onBlur={() => window.setTimeout(() => setCustomerOpen(false), 180)}
                />
                {customerOpen && customerHits.length > 0 ? (
                  <ul className="adm-combo-list" role="listbox">
                    {customerHits.map((row) => (
                      <li key={row.id}>
                        <button type="button" className="adm-combo-item adm-combo-item--dense" onMouseDown={() => pickCustomer(row)}>
                          <span className="adm-combo-item-title">{row.label}</span>
                          {row.code ? (
                            <span className="adm-combo-item-meta" dir="ltr">
                              {row.code}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="adm-field">
              <label htmlFor="ow-deal">סכום עסקה (USD)</label>
              <input
                id="ow-deal"
                required
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                disabled={busy}
                value={dealUsd}
                onChange={(e) => setDealUsd(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="adm-field">
              <label htmlFor="ow-comm">עמלה</label>
              <div className="adm-inline-row adm-inline-row--dense">
                <select
                  className="adm-inline-select adm-inline-select--dense"
                  disabled={busy}
                  value={commissionMode}
                  onChange={(e) => setCommissionMode(e.target.value as "USD" | "PERCENT")}
                  aria-label="סוג עמלה"
                >
                  <option value="USD">USD</option>
                  <option value="PERCENT">%</option>
                </select>
                <input
                  id="ow-comm"
                  type="text"
                  inputMode="decimal"
                  placeholder={commissionMode === "PERCENT" ? "%" : "USD"}
                  disabled={busy}
                  value={commissionValue}
                  onChange={(e) => setCommissionValue(e.target.value)}
                  dir="ltr"
                />
              </div>
            </div>

            <div className="adm-field">
              <label htmlFor="ow-paym">אמצעי תשלום</label>
              <select id="ow-paym" value={paymentMethod} disabled={busy} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                {Object.values(PaymentMethod).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m] ?? m}
                  </option>
                ))}
              </select>
            </div>
            <div className="adm-field">
              <label htmlFor="ow-currency">מטבע</label>
              <input
                id="ow-currency"
                type="text"
                readOnly
                className="adm-input-readonly adm-input-readonly--dense"
                value="USD"
                dir="ltr"
                title="סכום העסקה בדולר"
              />
            </div>

            <div className="adm-field-span-2">
              <div className="adm-order-summary adm-order-summary--dense">
                {ilsPreview ? (
                  <div className="adm-order-summary-dense" aria-label="סיכום מחושב">
                    <div className="adm-os-dense-cell">
                      <span className="adm-os-dense-lbl">סה״כ דולר</span>
                      <strong dir="ltr">${ilsPreview.totalUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}</strong>
                    </div>
                    <div className="adm-os-dense-cell">
                      <span className="adm-os-dense-lbl">שער סופי</span>
                      <strong dir="ltr">{ilsPreview.finalRate.toFixed(4)}</strong>
                    </div>
                    <div className="adm-os-dense-cell">
                      <span className="adm-os-dense-lbl">לפני מע״מ</span>
                      <strong>{fmtIls(ilsPreview.totalIlsWithoutVat)}</strong>
                    </div>
                    <div className="adm-os-dense-cell">
                      <span className="adm-os-dense-lbl">מע״מ ({ilsPreview.vatPercent}%)</span>
                      <strong>{fmtIls(ilsPreview.vatAmount)}</strong>
                    </div>
                    <div className="adm-os-dense-cell adm-os-dense-cell--span2">
                      <span className="adm-os-dense-lbl">סופי כולל מע״מ</span>
                      <strong className="adm-os-dense-total">{fmtIls(ilsPreview.totalIlsWithVat)}</strong>
                    </div>
                  </div>
                ) : (
                  <p className="adm-order-summary-fallback">הזן סכום עסקה בדולר לתצוגת סיכום.</p>
                )}
              </div>
            </div>

            <div className="adm-field adm-field-span-2">
              <label htmlFor="ow-notes">הערות</label>
              <textarea
                id="ow-notes"
                className="adm-capture-notes"
                rows={2}
                placeholder="הערות…"
                disabled={busy}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="adm-modal-actions adm-modal-actions--capture">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" disabled={busy} onClick={cancelForm}>
              ביטול
            </button>
            <button
              type="submit"
              className="adm-btn adm-btn--primary adm-btn--dense"
              disabled={busy || (panelKey.startsWith("edit:") && !canEditOrders)}
            >
              {panelKey.startsWith("edit:") ? "עדכון" : "שמירה"}
            </button>
          </div>
        </form>
      )}
    </aside>
  );
}
