"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OrderStatus, PaymentMethod } from "@prisma/client";
import {
  captureOrderAction,
  getOrderForWorkPanelAction,
  listCustomersForOrderQuickPickAction,
  previewOrderNumberAction,
  resolveCustomerForCaptureAction,
  searchCustomersForOrderAction,
  updateOrderWorkPanelAction,
  type CustomerSearchRow,
  type OrderCaptureSavedSummary,
  type OrderWorkPanelPayload,
} from "@/app/admin/capture/actions";
import { Modal } from "@/components/ui/Modal";
import { orderCaptureSplitMethodLabel, parseSplitPaymentMethodRaw } from "@/lib/order-capture-payment-methods";
import { previewOrderIlsSummary } from "@/lib/order-capture-preview";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { DEFAULT_WEEK_CODE, WORK_WEEK_CODES_SORTED, WORK_WEEK_RANGES, formatLocalHm, formatLocalYmd } from "@/lib/work-week";
import type { SerializedFinancial } from "@/lib/financial-settings";
import type { OrderCaptureWindowProps } from "@/lib/admin-windows";
import { newWindowId } from "@/lib/admin-windows";
import {
  OrderCapturePaymentsSection,
  type OrderCapturePaymentLineCurrency,
  type OrderCapturePaymentRow,
} from "@/components/admin/OrderCapturePaymentsSection";

const CUSTOMER_TYPES = ["רגיל", "סיטונאי", "סוכן", "מוסדי"] as const;

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  OPEN: "פתוחה",
  CANCELLED: "מבוטלת",
  WAITING_FOR_EXECUTION: "ממתינה לביצוע",
  WITHDRAWAL_FROM_SUPPLIER: "משיכה מספק",
  SENT: "נשלחה",
  WAITING_FOR_CHINA_EXECUTION: "ממתינה לביצוע סין",
  COMPLETED: "הושלמה",
};

type Props = {
  windowId: string;
  financial: SerializedFinancial | null;
  onToast: (msg: string) => void;
  canCreateOrders: boolean;
  canEditOrders: boolean;
  target: OrderCaptureWindowProps;
  onClose: () => void;
};

function parseNum(s: string): number {
  const t = s.replace(",", ".").trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

type FeeInputMode = "percent" | "amount";

/** אמצעי ראשי לשדה Order.paymentMethod — מהשורה הראשונה עם סכום, אחרת מהשורה הראשונה, אחרת העברה */
/** שווי USD לשורה (לווידוא יתרה מול סה״כ ההזמנה) — ₪ מחולקים ב־nisPerUsd */
function paymentRowUsdEquivalent(r: OrderCapturePaymentRow, nisPerUsd: number): number {
  const v = parseNum(r.amount);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const cur: OrderCapturePaymentLineCurrency = r.currency ?? "USD";
  if (cur === "ILS") {
    if (!Number.isFinite(nisPerUsd) || nisPerUsd <= 0) return NaN;
    return roundMoney2(v / nisPerUsd);
  }
  return roundMoney2(v);
}

function derivePrimaryPaymentMethod(rows: OrderCapturePaymentRow[]): PaymentMethod {
  for (const r of rows) {
    const v = parseNum(r.amount);
    if (Number.isFinite(v) && v > 0) return r.paymentMethod;
  }
  if (rows.length > 0) return rows[0].paymentMethod;
  return PaymentMethod.BANK_TRANSFER;
}

function panelKeyFromTarget(t: OrderCaptureWindowProps): string {
  if (t.mode === "create") return "create";
  return `edit:${t.orderId}`;
}

export function OrderWorkPanel({ windowId, financial, onToast, canCreateOrders, canEditOrders, target, onClose }: Props) {
  const router = useRouter();
  const { openWindow } = useAdminWindows();
  const idp = (s: string) => `${windowId}-${s}`;

  const panelKey = useMemo(() => panelKeyFromTarget(target), [target]);

  const [weekCode, setWeekCode] = useState(DEFAULT_WEEK_CODE);
  const [orderDateYmd, setOrderDateYmd] = useState(formatLocalYmd(new Date()));
  const [orderTimeHm, setOrderTimeHm] = useState(formatLocalHm(new Date()));
  const [orderNumberPreview, setOrderNumberPreview] = useState("");
  /** מספר הזמנה ביצירה — מתעדכן אוטומטית משבוע */
  const [orderNumberDraft, setOrderNumberDraft] = useState("");
  const [orderNumberEditUnlocked, setOrderNumberEditUnlocked] = useState(false);
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(OrderStatus.OPEN);

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerHits, setCustomerHits] = useState<CustomerSearchRow[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchRow | null>(null);
  const [customerType, setCustomerType] = useState<string>(CUSTOMER_TYPES[0]);

  const [exchangeRateDraft, setExchangeRateDraft] = useState("");
  const [customerPickList, setCustomerPickList] = useState<CustomerSearchRow[]>([]);

  const customerQueryRef = useRef(customerQuery);
  customerQueryRef.current = customerQuery;

  const [amountUsd, setAmountUsd] = useState("");
  const [feeUsd, setFeeUsd] = useState("");
  const [feeInputMode, setFeeInputMode] = useState<FeeInputMode>("amount");
  const [feePercentStr, setFeePercentStr] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadOrderBusy, setLoadOrderBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [savedUsdRate, setSavedUsdRate] = useState<string | null>(null);
  const [paymentRows, setPaymentRows] = useState<OrderCapturePaymentRow[]>([]);
  const [existingPaidUsd, setExistingPaidUsd] = useState(0);
  const [captureSavedSummary, setCaptureSavedSummary] = useState<OrderCaptureSavedSummary | null>(null);

  const finalRate = useMemo(() => {
    const f = financial?.finalDollarRate ? Number(financial.finalDollarRate.replace(",", ".")) : NaN;
    return Number.isFinite(f) && f > 0 ? f : 3.5;
  }, [financial]);

  const previewRate = useMemo(() => {
    const d = exchangeRateDraft.replace(",", ".").trim();
    if (d) {
      const n = Number(d);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return finalRate;
  }, [exchangeRateDraft, finalRate]);

  const customerTypeOptions = useMemo(() => {
    const base: string[] = [...CUSTOMER_TYPES];
    const t = selectedCustomer?.customerType?.trim();
    if (t && !base.includes(t)) base.push(t);
    return base;
  }, [selectedCustomer]);

  const customerDropdownRows = useMemo(() => {
    const map = new Map<string, CustomerSearchRow>();
    for (const c of customerPickList) map.set(c.id, c);
    if (selectedCustomer && !map.has(selectedCustomer.id)) map.set(selectedCustomer.id, selectedCustomer);
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "he"));
  }, [customerPickList, selectedCustomer]);

  function customerDisplayCode(c: CustomerSearchRow): string {
    const code = c.code?.trim();
    if (code) return code;
    return c.id.length > 14 ? `${c.id.slice(0, 10)}…` : c.id;
  }

  function handleCustomerDropdownSelect(customerId: string) {
    if (!customerId) {
      setSelectedCustomer(null);
      setCustomerQuery("");
      setCustomerType(CUSTOMER_TYPES[0]);
      return;
    }
    const row = customerDropdownRows.find((c) => c.id === customerId);
    if (row) {
      pickCustomer(row);
      return;
    }
    void resolveCustomerForCaptureAction(customerId).then((r) => {
      if (r) pickCustomer(r);
    });
  }

  const feeUsdResolved = useMemo(() => {
    const amt = parseNum(amountUsd);
    if (feeInputMode === "percent") {
      const p = parseNum(feePercentStr);
      if (!Number.isFinite(amt) || amt <= 0) return 0;
      if (!Number.isFinite(p) || p < 0) return 0;
      return roundMoney2(amt * (p / 100));
    }
    const f = parseNum(feeUsd);
    return Number.isFinite(f) && f >= 0 ? roundMoney2(f) : 0;
  }, [feeInputMode, feePercentStr, feeUsd, amountUsd]);

  const ilsPreview = useMemo(() => {
    const amt = parseNum(amountUsd);
    const fee = feeUsdResolved;
    if (!Number.isFinite(amt) || amt <= 0) return null;
    return previewOrderIlsSummary(amt, fee, previewRate, 18);
  }, [amountUsd, feeUsdResolved, previewRate]);

  const feeUsdStrForSave = useMemo(() => {
    if (!Number.isFinite(feeUsdResolved) || feeUsdResolved < 0) return "0";
    return feeUsdResolved.toFixed(2);
  }, [feeUsdResolved]);

  const feePercentDisplay = useMemo(() => {
    const amt = parseNum(amountUsd);
    if (!Number.isFinite(amt) || amt <= 0) return 0;
    if (!Number.isFinite(feeUsdResolved) || feeUsdResolved <= 0) return 0;
    return roundMoney2((feeUsdResolved / amt) * 100);
  }, [amountUsd, feeUsdResolved]);

  const switchFeeInputMode = useCallback(
    (next: FeeInputMode) => {
      if (next === feeInputMode) return;
      const amt = parseNum(amountUsd);
      if (next === "percent") {
        const f = feeInputMode === "amount" ? parseNum(feeUsd) : feeUsdResolved;
        if (Number.isFinite(amt) && amt > 0 && Number.isFinite(f) && f >= 0) {
          setFeePercentStr(f === 0 ? "0" : String(roundMoney2((f / amt) * 100)));
        } else setFeePercentStr("0");
        setFeeInputMode("percent");
        return;
      }
      const p = parseNum(feePercentStr);
      if (Number.isFinite(amt) && amt > 0 && Number.isFinite(p) && p >= 0) {
        setFeeUsd(roundMoney2(amt * (p / 100)).toFixed(2));
      } else setFeeUsd("0");
      setFeeInputMode("amount");
    },
    [feeInputMode, amountUsd, feeUsd, feePercentStr, feeUsdResolved],
  );

  const formPaymentsUsd = useMemo(() => {
    return paymentRows.reduce((acc, r) => {
      const eq = paymentRowUsdEquivalent(r, previewRate);
      if (Number.isNaN(eq)) return acc;
      return acc + eq;
    }, 0);
  }, [paymentRows, previewRate]);

  const orderTotalUsdForPayments = ilsPreview?.totalUsd ?? null;

  const paymentRowParseError = useMemo(() => {
    for (const r of paymentRows) {
      if (!r.amount.trim()) continue;
      const v = parseNum(r.amount);
      if (!Number.isFinite(v) || v <= 0) return "סכום בשורת תשלום לא תקין.";
      if ((r.currency ?? "USD") === "ILS" && (!Number.isFinite(previewRate) || previewRate <= 0)) {
        return "שער דולר חיובי נדרש לשורות תשלום בשקלים.";
      }
    }
    return null;
  }, [paymentRows, previewRate]);

  const paymentTotalError = useMemo(() => {
    const hasRowAmount = paymentRows.some((r) => r.amount.trim().length > 0);
    if (hasRowAmount && !ilsPreview) {
      return "יש להזין סכום USD תקין בהזמנה כדי לשמור שורות תשלום.";
    }
    if (orderTotalUsdForPayments == null || !Number.isFinite(orderTotalUsdForPayments)) return null;
    const totalPaid = existingPaidUsd + formPaymentsUsd;
    if (totalPaid > orderTotalUsdForPayments + 1e-6) {
      return `סכום התשלומים (${totalPaid.toFixed(2)}) חורג מסה״כ ההזמנה (${orderTotalUsdForPayments.toFixed(2)}) USD.`;
    }
    if (panelKey === "create" && hasRowAmount && totalPaid < orderTotalUsdForPayments - 0.01) {
      return `חסר תשלום: סה״כ השורות חייב לסגור את ${orderTotalUsdForPayments.toFixed(2)} USD (נותר ${(orderTotalUsdForPayments - totalPaid).toFixed(2)}).`;
    }
    return null;
  }, [paymentRows, ilsPreview, existingPaidUsd, formPaymentsUsd, orderTotalUsdForPayments, panelKey]);

  const paymentBlockError = paymentRowParseError || paymentTotalError;

  function addPaymentRow() {
    setPaymentRows((rows) => [
      ...rows,
      { id: `pay-${newWindowId()}`, paymentMethod: PaymentMethod.CASH, currency: "USD", amount: "" },
    ]);
  }

  function changePaymentRow(
    id: string,
    patch: Partial<Pick<OrderCapturePaymentRow, "paymentMethod" | "amount" | "currency">>,
  ) {
    setPaymentRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removePaymentRow(id: string) {
    setPaymentRows((rows) => rows.filter((r) => r.id !== id));
  }

  const paymentRemainingUsd = useMemo(() => {
    if (orderTotalUsdForPayments == null || !Number.isFinite(orderTotalUsdForPayments)) return null;
    return Math.max(0, orderTotalUsdForPayments - existingPaidUsd - formPaymentsUsd);
  }, [orderTotalUsdForPayments, existingPaidUsd, formPaymentsUsd]);

  const fillRemainingCash = useCallback(() => {
    if (paymentRemainingUsd == null || paymentRemainingUsd < 1e-6) return;
    const s = paymentRemainingUsd.toFixed(2);
    setPaymentRows((rows) => {
      const idx = rows.findIndex((r) => r.paymentMethod === PaymentMethod.CASH && !r.amount.trim());
      if (idx >= 0) {
        return rows.map((r, i) => (i === idx ? { ...r, currency: "USD" as const, amount: s } : r));
      }
      return [...rows, { id: `pay-${newWindowId()}`, paymentMethod: PaymentMethod.CASH, currency: "USD", amount: s }];
    });
  }, [paymentRemainingUsd]);

  const fillRemainingCashIls = useCallback(() => {
    if (paymentRemainingUsd == null || paymentRemainingUsd < 1e-6) return;
    if (!Number.isFinite(previewRate) || previewRate <= 0) return;
    const nis = roundMoney2(paymentRemainingUsd * previewRate);
    if (nis <= 0) return;
    const s = nis.toFixed(2);
    setPaymentRows((rows) => {
      const idx = rows.findIndex((r) => r.paymentMethod === PaymentMethod.CASH && !r.amount.trim());
      if (idx >= 0) {
        return rows.map((r, i) => (i === idx ? { ...r, currency: "ILS" as const, amount: s } : r));
      }
      return [...rows, { id: `pay-${newWindowId()}`, paymentMethod: PaymentMethod.CASH, currency: "ILS", amount: s }];
    });
  }, [paymentRemainingUsd, previewRate]);

  const splitRemainingHalfCashCredit = useCallback(() => {
    if (paymentRemainingUsd == null || paymentRemainingUsd < 1e-6) return;
    const rem = paymentRemainingUsd;
    const half = Math.round((rem / 2) * 100) / 100;
    const other = Math.round((rem - half) * 100) / 100;
    setPaymentRows((rows) => [
      ...rows,
      { id: `pay-${newWindowId()}`, paymentMethod: PaymentMethod.CASH, currency: "USD", amount: half.toFixed(2) },
      { id: `pay-${newWindowId()}`, paymentMethod: PaymentMethod.CREDIT, currency: "USD", amount: other.toFixed(2) },
    ]);
  }, [paymentRemainingUsd]);

  function buildPaymentLinesForSubmit() {
    return paymentRows
      .filter((r) => r.amount.trim())
      .map((r) => {
        const cur = r.currency ?? "USD";
        const method = parseSplitPaymentMethodRaw(r.paymentMethod) ?? r.paymentMethod;
        return {
          paymentMethod: method,
          amountUsd: r.amount.trim(),
          ...(cur === "ILS" ? { currency: "ILS" as const } : {}),
        };
      });
  }

  const loadPreviewNumber = useCallback(async (wc: string) => {
    try {
      const n = await previewOrderNumberAction(wc);
      const v = n || "—";
      setOrderNumberPreview(v);
      if (panelKey === "create" && !orderNumberEditUnlocked) setOrderNumberDraft(v);
    } catch {
      setOrderNumberPreview("—");
      if (panelKey === "create" && !orderNumberEditUnlocked) setOrderNumberDraft("—");
    }
  }, [panelKey, orderNumberEditUnlocked]);

  const pickCustomer = useCallback((row: CustomerSearchRow) => {
    setSelectedCustomer(row);
    setCustomerQuery(row.label);
    const ty = row.customerType?.trim();
    if (ty) setCustomerType(ty);
    else setCustomerType(CUSTOMER_TYPES[0]);
    setCustomerOpen(false);
  }, []);

  const applyLoadedOrder = useCallback((p: OrderWorkPanelPayload) => {
    setEditOrderId(p.id);
    setWeekCode(p.weekCode in WORK_WEEK_RANGES ? p.weekCode : DEFAULT_WEEK_CODE);
    setOrderDateYmd(p.orderDateYmd);
    setOrderTimeHm(p.orderTimeHm || "00:00");
    setOrderNumberPreview(p.orderNumber);
    setOrderNumberDraft(p.orderNumber);
    setOrderStatus(p.status);
    setSavedUsdRate(p.usdRateUsed);
    setExistingPaidUsd(Number(p.existingPaymentsUsdSum.replace(",", ".")) || 0);
    setPaymentRows([]);
    setCustomerQuery(p.customerLabel);
    setSelectedCustomer({
      id: p.customerId,
      label: p.customerLabel,
      code: p.customerCode,
      customerType: p.customerType,
      city: null,
      phone: null,
    });
    setCustomerType(p.customerType);
    setAmountUsd(p.amountUsd);
    setFeeUsd(p.feeUsd);
    setFeeInputMode("amount");
    setFeePercentStr("");
    setNotes(p.notes);
    setExchangeRateDraft(p.usdRateUsed.replace(",", "."));
    setErr(null);
  }, []);

  useEffect(() => {
    if (panelKey === "create") {
      if (!canCreateOrders) return;
      setWeekCode(DEFAULT_WEEK_CODE);
      setOrderDateYmd(formatLocalYmd(new Date()));
      setOrderTimeHm(formatLocalHm(new Date()));
      setOrderStatus(OrderStatus.OPEN);
      setSavedUsdRate(null);
      setCustomerQuery("");
      setCustomerHits([]);
      setCustomerOpen(false);
      setSelectedCustomer(null);
      setCustomerType(CUSTOMER_TYPES[0]);
      setOrderNumberEditUnlocked(false);
      setExchangeRateDraft(
        financial?.finalDollarRate ? String(financial.finalDollarRate).replace(",", ".") : "3.5",
      );
      setAmountUsd("");
      setFeeUsd("");
      setFeeInputMode("amount");
      setFeePercentStr("");
      setNotes("");
      setErr(null);
      setEditOrderId(null);
      setPaymentRows([{ id: `pay-${newWindowId()}`, paymentMethod: PaymentMethod.CASH, currency: "USD", amount: "" }]);
      setExistingPaidUsd(0);
      void loadPreviewNumber(DEFAULT_WEEK_CODE);
      return;
    }

    const orderId = panelKey.startsWith("edit:") ? panelKey.slice(5) : "";
    if (!orderId || !canEditOrders) return;

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
  }, [panelKey, applyLoadedOrder, loadPreviewNumber, canCreateOrders, canEditOrders, financial]);

  useEffect(() => {
    if (panelKey !== "create") return;
    void loadPreviewNumber(weekCode);
  }, [weekCode, panelKey, loadPreviewNumber]);

  useEffect(() => {
    if (!customerOpen) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        const raw = customerQueryRef.current;
        const qn = raw.trim();
        if (cancelled) return;

        if (qn.length >= 2) {
          const byKey = await resolveCustomerForCaptureAction(qn);
          if (cancelled || customerQueryRef.current.trim() !== qn) return;
          if (byKey) {
            const idMatch = qn === byKey.id;
            const codeMatch = (byKey.code || "").trim().toLowerCase() === qn.toLowerCase();
            if (idMatch || codeMatch) {
              pickCustomer(byKey);
              return;
            }
          }
        }

        const hits = await searchCustomersForOrderAction(raw);
        if (cancelled || customerQueryRef.current.trim() !== qn) return;
        setCustomerHits(hits);
        if (qn.length >= 2) {
          const low = qn.toLowerCase();
          const exact = hits.find((h) => h.label.trim().toLowerCase() === low);
          if (exact) pickCustomer(exact);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [customerQuery, customerOpen, pickCustomer]);

  useEffect(() => {
    if (!canCreateOrders && !canEditOrders) return;
    void listCustomersForOrderQuickPickAction().then(setCustomerPickList);
  }, [canCreateOrders, canEditOrders, panelKey]);

  async function openCustomerLedger() {
    let id = selectedCustomer?.id;
    let name = selectedCustomer?.label ?? "";
    if (!id && customerQuery.trim()) {
      const r = await resolveCustomerForCaptureAction(customerQuery.trim());
      if (r) {
        pickCustomer(r);
        id = r.id;
        name = r.label;
      }
    }
    if (!id) {
      setErr("יש לבחור לקוח קודם");
      return;
    }
    openWindow({ type: "customerCard", props: { customerId: id, customerName: name, initialTab: "ledger" } });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (paymentBlockError) {
      setErr(paymentBlockError);
      return;
    }

    let cust: CustomerSearchRow | null = selectedCustomer;
    if (!cust && customerQuery.trim()) {
      cust = await resolveCustomerForCaptureAction(customerQuery.trim());
    }
    if (!cust && customerQuery.trim()) {
      const hits = await searchCustomersForOrderAction(customerQuery.trim());
      const qn = customerQuery.trim().toLowerCase();
      cust =
        hits.find((h) => h.label.trim().toLowerCase() === qn) ??
        hits.find((h) => (h.code || "").trim().toLowerCase() === qn) ??
        null;
    }
    if (!cust) {
      setErr("יש לבחור לקוח, או להזין מזהה / קוד / שם מדויק כפי שמופיע במערכת");
      return;
    }

    const paymentLines = buildPaymentLinesForSubmit();

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
        orderTimeHm,
        customerId: cust.id,
        customerTypeSnapshot: customerType,
        amountUsd,
        feeUsd: feeUsdStrForSave,
        paymentMethod: derivePrimaryPaymentMethod(paymentRows),
        status: orderStatus,
        notes,
        paymentLines,
      });
      setBusy(false);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onToast("הזמנה עודכנה");
      router.refresh();
      onClose();
      return;
    }

    if (!canCreateOrders) {
      setErr("אין הרשאה ליצירת הזמנה");
      return;
    }
    setBusy(true);
    setErr(null);
    const ord = orderNumberDraft.trim();
    const orderNumberOpt = ord && ord !== "—" ? ord : undefined;
    const res = await captureOrderAction({
      weekCode,
      orderDateYmd,
      orderTimeHm,
      orderNumber: orderNumberOpt,
      finalRateOverride: exchangeRateDraft.trim() || undefined,
      customerId: cust.id,
      customerTypeSnapshot: customerType,
      amountUsd,
      feeUsd: feeUsdStrForSave,
      paymentMethod: derivePrimaryPaymentMethod(paymentRows),
      status: orderStatus,
      notes,
      paymentLines,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    onToast("הזמנה נשמרה בהצלחה");
    router.refresh();
    if (res.saved) {
      setCaptureSavedSummary(res.saved);
    } else {
      onClose();
    }
  }

  const fmtIls = (n: number) =>
    new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 }).format(n);

  const handleCloseSavedCapture = useCallback(() => {
    setCaptureSavedSummary(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    setCaptureSavedSummary(null);
  }, [panelKey]);

  if (target.mode === "create" && !canCreateOrders) return null;
  if (target.mode === "edit" && !canEditOrders) return null;

  const savedPaySum =
    captureSavedSummary?.payments.reduce((s, p) => s + Number(p.amountUsd.replace(",", ".")), 0) ?? 0;
  const savedPayTotal = captureSavedSummary ? Number(captureSavedSummary.totalUsd.replace(",", ".")) : 0;
  const savedPaidFull =
    !!captureSavedSummary &&
    captureSavedSummary.payments.length > 0 &&
    Math.abs(savedPaySum - savedPayTotal) <= 0.02;

  return (
    <>
    <div className="adm-win-order-wrap">
      {loadOrderBusy ? (
        <p className="adm-order-work-panel-loading">טוען…</p>
      ) : (
        <form className="adm-capture-order-shell adm-order-capture-compact" onSubmit={onSubmit}>
          {err ? <div className="adm-error adm-error--compact">{err}</div> : null}

          <div className="adm-order-layout adm-capture-desktop">
            <section className="adm-capture-sec adm-cap-sec-order" aria-labelledby={idp("cap-a")}>
              <h3 id={idp("cap-a")} className="adm-capture-sec-title">
                פרטי הזמנה
              </h3>
              <div className="adm-capture-sec-grid adm-capture-sec-grid--4">
                <div className="adm-field adm-field--capture adm-field-span-full">
                  <label htmlFor={idp("ordnum")}>מספר הזמנה</label>
                  <div className="adm-ordnum-row">
                    <input
                      id={idp("ordnum")}
                      type="text"
                      readOnly={panelKey !== "create" || !orderNumberEditUnlocked}
                      className={
                        panelKey === "create" && orderNumberEditUnlocked ? undefined : "adm-input-readonly adm-input-readonly--dense"
                      }
                      value={panelKey === "create" ? orderNumberDraft || "…" : orderNumberPreview || "…"}
                      dir="ltr"
                      disabled={busy}
                      onChange={panelKey === "create" && orderNumberEditUnlocked ? (e) => setOrderNumberDraft(e.target.value) : undefined}
                      title={
                        panelKey === "create"
                          ? "מספור רץ לפי השבוע (למשל AH-118-0001). סמן עריכה לשינוי ידני."
                          : undefined
                      }
                    />
                    {panelKey === "create" ? (
                      <label className="adm-ordnum-unlock">
                        <input
                          type="checkbox"
                          checked={orderNumberEditUnlocked}
                          disabled={busy}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setOrderNumberEditUnlocked(on);
                            if (!on) {
                              void previewOrderNumberAction(weekCode).then((n) => setOrderNumberDraft(n || "—"));
                            }
                          }}
                        />
                        עריכה
                      </label>
                    ) : null}
                  </div>
                </div>
                <div className="adm-field adm-field--capture">
                  <label htmlFor={idp("date")}>תאריך</label>
                  <input
                    id={idp("date")}
                    type="date"
                    required
                    disabled={busy}
                    value={orderDateYmd}
                    onChange={(e) => setOrderDateYmd(e.target.value)}
                  />
                </div>
                <div className="adm-field adm-field--capture">
                  <label htmlFor={idp("week")}>שבוע</label>
                  <select
                    id={idp("week")}
                    value={weekCode}
                    disabled={busy}
                    onChange={(e) => {
                      const code = e.target.value;
                      setWeekCode(code);
                      setOrderNumberEditUnlocked(false);
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
                <div className="adm-field adm-field--capture">
                  <label htmlFor={idp("time")}>שעה</label>
                  <input id={idp("time")} type="time" disabled={busy} value={orderTimeHm} onChange={(e) => setOrderTimeHm(e.target.value)} />
                </div>
              </div>
            </section>

            <section className="adm-capture-sec adm-cap-sec-customer" aria-labelledby={idp("cap-b")}>
              <h3 id={idp("cap-b")} className="adm-capture-sec-title">
                לקוח
              </h3>
              <div className="adm-cust-panel-stack">
                <div className="adm-field adm-field--capture">
                  <label htmlFor={idp("cust-sel")}>בחר לקוח במערכת</label>
                  <div className="adm-cust-select-with-ledger">
                    <select
                      id={idp("cust-sel")}
                      className="adm-cust-quick-select"
                      value={selectedCustomer?.id ?? ""}
                      disabled={busy}
                      onChange={(e) => handleCustomerDropdownSelect(e.target.value)}
                    >
                      <option value="">— בחרו לקוח מהרשימה —</option>
                      {customerDropdownRows.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label} ({customerDisplayCode(c)})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="adm-btn adm-btn--ghost adm-btn--dense adm-btn--xs adm-cust-ledger-open"
                      disabled={busy}
                      onClick={() => void openCustomerLedger()}
                      title={selectedCustomer ? `כרטסת לקוח: ${selectedCustomer.label}` : "יש לבחור לקוח קודם"}
                      aria-label="פתיחת כרטסת לקוח"
                    >
                      <span aria-hidden>📊</span>
                      <span>כרטסת לקוח</span>
                    </button>
                  </div>
                </div>

                {selectedCustomer ? (
                  <div className="adm-cust-details">
                    <div className="adm-cust-details-name">{selectedCustomer.label}</div>
                    <div className="adm-cust-details-id" dir="ltr">
                      מזהה: {customerDisplayCode(selectedCustomer)}
                    </div>
                    {selectedCustomer.phone ? (
                      <div className="adm-cust-details-phone" dir="ltr">
                        {selectedCustomer.phone}
                      </div>
                    ) : null}
                    {selectedCustomer.city ? <div className="adm-cust-details-city">עיר: {selectedCustomer.city}</div> : null}
                  </div>
                ) : (
                  <p className="adm-cust-details-empty">בחרו לקוח מהרשימה או השתמשו בחיפוש למטה.</p>
                )}

                <div className="adm-cust-type-and-card">
                  <div className="adm-field adm-field--capture">
                    <label htmlFor={idp("cust-type")}>סוג לקוח</label>
                    <select id={idp("cust-type")} value={customerType} disabled={busy} onChange={(e) => setCustomerType(e.target.value)}>
                      {customerTypeOptions.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="adm-field adm-field--capture adm-cust-search-adv">
                  <label htmlFor={idp("cust-q")}>חיפוש (מתקדם)</label>
                  <div className="adm-combo adm-combo--dense adm-combo--compact-cap adm-cust-search-combo">
                    <input
                      id={idp("cust-q")}
                      type="text"
                      autoComplete="off"
                      placeholder="בחרו לקוח מהרשימה למעלה או חפשו לפי שם · קוד · טלפון · מזהה"
                      disabled={busy}
                      value={customerQuery}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCustomerQuery(v);
                        setCustomerOpen(true);
                        if (!v.trim()) {
                          setSelectedCustomer(null);
                          setCustomerType(CUSTOMER_TYPES[0]);
                          return;
                        }
                        if (selectedCustomer && v.trim().toLowerCase() !== selectedCustomer.label.trim().toLowerCase()) {
                          setSelectedCustomer(null);
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
                              <span className="adm-combo-item-meta" dir="ltr">
                                מזהה {customerDisplayCode(row)}
                                {row.phone ? ` · ${row.phone}` : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="adm-capture-sec adm-cap-sec-amounts" aria-labelledby={idp("cap-d")}>
              <h3 id={idp("cap-d")} className="adm-capture-sec-title">
                סכומים
              </h3>
              <p className="adm-cap-amounts-lead">
                סכום העסקה והעמלה מוזנים ב־<strong dir="ltr">USD</strong>. חישוב השקלים למטה לפי שער. בפיצול תשלום אפשר לרשום כל שורה בדולר או בשקל.
              </p>
              {panelKey === "create" ? (
                <div className="adm-field adm-field--capture adm-field--inline adm-cap-rate-field">
                  <label htmlFor={idp("rate")}>שער דולר (₪/USD)</label>
                  <input
                    id={idp("rate")}
                    type="text"
                    inputMode="decimal"
                    disabled={busy}
                    value={exchangeRateDraft}
                    onChange={(e) => setExchangeRateDraft(e.target.value)}
                    dir="ltr"
                    title="שער סופי לחישוב שקל (ניתן לעדכן לפני שמירה)"
                  />
                </div>
              ) : null}
              <div className="adm-cap-amount-inputs">
                <div className="adm-field adm-field--capture">
                  <label htmlFor={idp("amt")}>סכום (USD)</label>
                  <input
                    id={idp("amt")}
                    required
                    type="text"
                    inputMode="decimal"
                    placeholder="הזינו סכום בדולר (USD)…"
                    disabled={busy}
                    value={amountUsd}
                    onChange={(e) => setAmountUsd(e.target.value)}
                    dir="ltr"
                  />
                </div>

                <fieldset className="adm-fee-fieldset" disabled={busy}>
                  <legend className="adm-fee-legend">עמלה</legend>
                  <div className="adm-fee-toggle" role="radiogroup" aria-label="אופן הזנת עמלה">
                    <label className="adm-fee-toggle-opt">
                      <input type="radio" name={idp("fee-mode")} checked={feeInputMode === "percent"} onChange={() => switchFeeInputMode("percent")} />
                      עמלה (%)
                    </label>
                    <label className="adm-fee-toggle-opt">
                      <input type="radio" name={idp("fee-mode")} checked={feeInputMode === "amount"} onChange={() => switchFeeInputMode("amount")} />
                      עמלה ($)
                    </label>
                  </div>
                  {feeInputMode === "percent" ? (
                    <div className="adm-field adm-field--capture">
                      <label htmlFor={idp("fee-pct")}>אחוז עמלה</label>
                      <input
                        id={idp("fee-pct")}
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        disabled={busy}
                        value={feePercentStr}
                        onChange={(e) => setFeePercentStr(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  ) : (
                    <div className="adm-field adm-field--capture">
                      <label htmlFor={idp("fee")}>עמלה (USD)</label>
                      <input
                        id={idp("fee")}
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        disabled={busy}
                        value={feeUsd}
                        onChange={(e) => setFeeUsd(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  )}
                  {ilsPreview && parseNum(amountUsd) > 0 ? (
                    <p className="adm-fee-summary" dir="ltr">
                      עמלה: ${feeUsdResolved.toFixed(2)} ({feePercentDisplay.toFixed(2)}%)
                    </p>
                  ) : null}
                </fieldset>
              </div>

              <div className="adm-deal-box" aria-live="polite">
                <div className="adm-deal-title">נתוני עסקה ₪</div>
                {ilsPreview ? (
                  <>
                    <div className="adm-deal-row">
                      <span>סכום ₪</span>
                      <span dir="ltr" className="adm-deal-val">
                        {fmtIls(roundMoney2(ilsPreview.amountUsd * ilsPreview.finalRate))}
                      </span>
                    </div>
                    <div className="adm-deal-row">
                      <span>סכום עמלה ₪</span>
                      <span dir="ltr" className="adm-deal-val">
                        {fmtIls(roundMoney2(ilsPreview.feeUsd * ilsPreview.finalRate))}
                      </span>
                    </div>
                    <div className="adm-deal-row">
                      <span>סכום כולל עמלה ₪</span>
                      <span dir="ltr" className="adm-deal-val">
                        {fmtIls(ilsPreview.totalIlsWithoutVat)}
                      </span>
                    </div>
                    <div className="adm-deal-row">
                      <span>סכום מע״מ ₪ ({ilsPreview.vatPercent}%)</span>
                      <span dir="ltr" className="adm-deal-val">
                        {fmtIls(ilsPreview.vatAmount)}
                      </span>
                    </div>
                    <div className="adm-deal-row adm-deal-row--total">
                      <span>סכום כולל מע״מ ₪</span>
                      <span dir="ltr" className="adm-deal-val">
                        {fmtIls(ilsPreview.totalIlsWithVat)}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="adm-deal-empty">הזינו סכום USD (ועמלה) כדי להציג חישוב בשקלים.</p>
                )}
              </div>
              {ilsPreview ? (
                <p className="adm-capture-rate-hint adm-capture-rate-hint--compact" dir="ltr">
                  שער: {ilsPreview.finalRate.toFixed(4)} ₪/USD
                  {panelKey.startsWith("edit:") && savedUsdRate ? (
                    <span className="adm-capture-rate-hint-muted"> · נשמר: {savedUsdRate}</span>
                  ) : null}
                </p>
              ) : (
                <p className="adm-order-summary-fallback adm-order-summary-fallback--compact">הזן סכום USD לתצוגה.</p>
              )}
            </section>

            <OrderCapturePaymentsSection
              idPrefix={idp("pay")}
              disabled={busy}
              rows={paymentRows}
              onAddRow={addPaymentRow}
              onChangeRow={changePaymentRow}
              onRemoveRow={removePaymentRow}
              formPaymentsUsd={formPaymentsUsd}
              existingPaidUsd={existingPaidUsd}
              orderTotalUsd={orderTotalUsdForPayments}
              validationError={paymentBlockError}
              orderStatus={orderStatus}
              onOrderStatusChange={setOrderStatus}
              orderStatusLabels={ORDER_STATUS_LABELS}
              onFillRemainingCash={fillRemainingCash}
              onFillRemainingCashIls={fillRemainingCashIls}
              onSplitRemainingHalfCashCredit={splitRemainingHalfCashCredit}
              rateNisPerUsd={previewRate}
            />

            <div className="adm-field adm-field--capture adm-field-span-full adm-cap-footer-notes">
              <label htmlFor={idp("notes")}>הערות</label>
              <input
                id={idp("notes")}
                type="text"
                className="adm-capture-notes-line"
                placeholder="—"
                maxLength={500}
                disabled={busy}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="adm-modal-actions adm-modal-actions--capture">
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" disabled={busy} onClick={onClose}>
              ביטול
            </button>
            <button
              type="submit"
              className="adm-btn adm-btn--primary adm-btn--dense"
              disabled={busy || !!paymentBlockError || (panelKey.startsWith("edit:") && !canEditOrders)}
            >
              {panelKey.startsWith("edit:") ? "עדכון" : "שמירה"}
            </button>
          </div>
        </form>
      )}
    </div>

    <Modal
      open={!!captureSavedSummary}
      onClose={handleCloseSavedCapture}
      title="הזמנה נשמרה בהצלחה"
      size="sm"
      modalClassName="adm-cap-saved-modal"
    >
      {captureSavedSummary ? (
        <div className="adm-cap-saved-body">
          <div
            className={
              captureSavedSummary.payments.length === 0
                ? "adm-cap-saved-status adm-cap-saved-status--neutral"
                : savedPaidFull
                  ? "adm-cap-saved-status adm-cap-saved-status--paid"
                  : "adm-cap-saved-status adm-cap-saved-status--partial"
            }
            role="status"
          >
            {captureSavedSummary.payments.length === 0
              ? "הזמנה נוצרה ללא שורות תשלום בפיצול"
              : savedPaidFull
                ? "שולם במלואו לפי שורות התשלום"
                : "סכום שורות התשלום אינו תואם לסה״כ — בדוק ברשומה"}
          </div>
          <div className="adm-cap-saved-summary">
            <p>
              <b>מספר הזמנה:</b> <span dir="ltr">{captureSavedSummary.orderNumber}</span>
            </p>
            <p>
              <b>לקוח:</b> {captureSavedSummary.customerLabel}
            </p>
            <p>
              <b>סה״כ:</b>{" "}
              <span dir="ltr">
                $ {Number(captureSavedSummary.totalUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </p>
          </div>
          {captureSavedSummary.payments.length > 0 ? (
            <div className="adm-cap-saved-payments">
              <div className="adm-cap-saved-payments-title">תשלומים שנשמרו</div>
              {captureSavedSummary.payments.map((p, i) => (
                <div key={`${p.paymentMethod}-${i}`} className="adm-cap-saved-pay-row">
                  <span>{orderCaptureSplitMethodLabel(p.paymentMethod)}</span>
                  <span dir="ltr">$ {p.amountUsd}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="adm-cap-saved-actions">
            <button type="button" className="adm-btn adm-btn--primary adm-btn--dense" onClick={handleCloseSavedCapture}>
              סגור
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
    </>
  );
}
