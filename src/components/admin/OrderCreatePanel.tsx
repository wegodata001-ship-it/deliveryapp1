"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OrderStatus, PaymentMethod } from "@prisma/client";
import { User } from "lucide-react";
import {
  captureOrderAction,
  getCustomerOrderFormExtrasAction,
  getOrderForWorkPanelAction,
  listCustomersForOrderQuickPickAction,
  createPaymentPointForOrderAction,
  listPaymentPointsForOrderAction,
  previewOrderNumberAction,
  resolveCustomerForCaptureAction,
  searchCustomersForOrderAction,
  updateOrderWorkPanelAction,
  type CustomerSearchRow,
} from "@/app/admin/capture/actions";
import { getSelectedCountriesForOrdersAction } from "@/app/admin/settings/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import Card from "@/components/ui/Card";
import type { OrderCaptureWindowProps } from "@/lib/admin-windows";
import { ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS } from "@/lib/order-capture-payment-methods";
import { orderCountryLabel, ORDER_COUNTRY_CODES, coerceOrderCountryForForm, type OrderCountryCode } from "@/lib/order-countries";
import type { SerializedFinancial } from "@/lib/financial-settings";
import {
  DEFAULT_WEEK_CODE,
  formatLocalHm,
  formatLocalYmd,
  getWeekCodeForLocalDate,
  parseLocalDate,
  WORK_WEEK_RANGES,
} from "@/lib/work-week";

const VAT_FRACTION = 0.17;

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function toWeekCode(n: number): string {
  const nn = Math.max(1, Math.floor(n));
  return `AH-${nn}`;
}

function parseWeekNumber(raw: string): number | null {
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  const m = t.match(/^AH-(\d{1,4})$/);
  if (m?.[1]) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d{1,4}$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** סטטוסים במסך קליטה מהירה — תואם enum במסד */
const CREATE_ORDER_STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: OrderStatus.OPEN, label: "פתוחה" },
  { value: OrderStatus.WAITING_FOR_EXECUTION, label: "בטיפול" },
  { value: OrderStatus.COMPLETED, label: "הושלמה" },
];

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  OPEN: "פתוחה",
  CANCELLED: "מבוטלת",
  WAITING_FOR_EXECUTION: "ממתינה לביצוע",
  WITHDRAWAL_FROM_SUPPLIER: "משיכה מספק",
  SENT: "נשלחה",
  WAITING_FOR_CHINA_EXECUTION: "ממתינה לביצוע סין",
  COMPLETED: "הושלמה",
};

const EDIT_ORDER_STATUS_OPTIONS: { value: OrderStatus; label: string }[] = (
  Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]
).map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }));

type ComboField = "code" | "nameAr" | "nameHe";

function parseNum(s: string): number {
  const t = s.replace(",", ".").trim();
  if (t === "") return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function commissionPercentFromFinancial(f: SerializedFinancial | null): number {
  if (!f) return 0;
  const base = Number(String(f.baseDollarRate).replace(",", "."));
  const fee = Number(String(f.dollarFee).replace(",", "."));
  if (!Number.isFinite(base) || base <= 0) return 0;
  return roundMoney2((fee / base) * 100);
}

function customerDisplayCode(c: CustomerSearchRow): string {
  const code = c.code?.trim();
  if (code) return code;
  return c.id.length > 14 ? `${c.id.slice(0, 10)}…` : c.id;
}

type Props = {
  windowId: string;
  financial: SerializedFinancial | null;
  onToast: (msg: string) => void;
  canCreateOrders: boolean;
  canEditOrders: boolean;
  target: OrderCaptureWindowProps;
  onClose: () => void;
  /** נקרא רק אחרי שמירה מוצלחת (לפני onClose) — לדוגמה רענון רשימה במסך הקליטה */
  onSaved?: () => void;
};

export function OrderCreatePanel({
  windowId,
  financial,
  onToast,
  canCreateOrders,
  canEditOrders,
  target,
  onClose,
  onSaved,
}: Props) {
  const router = useRouter();
  const { openWindow } = useAdminWindows();
  const { runWithLoading } = useAdminLoading();
  const { globalWeek, globalCountry } = useAdminGlobal();
  const idp = (s: string) => `${windowId}-${s}`;

  const isEdit = target.mode === "edit";

  const initialDt = useMemo(() => {
    const d = new Date();
    return { ymd: formatLocalYmd(d), hm: formatLocalHm(d) };
  }, []);

  const baseWeekNumber = useMemo(() => parseWeekNumber(globalWeek) ?? parseWeekNumber(DEFAULT_WEEK_CODE) ?? 1, [globalWeek]);
  const baseDate = useMemo(() => {
    const from = WORK_WEEK_RANGES[globalWeek]?.from;
    return from ? parseLocalDate(from) : new Date();
  }, [globalWeek]);

  const [orderDateYmd, setOrderDateYmd] = useState(() => {
    const now = new Date();
    const cur = getWeekCodeForLocalDate(now);
    if (globalWeek === cur) return formatLocalYmd(now);
    const from = WORK_WEEK_RANGES[globalWeek]?.from;
    return from ?? initialDt.ymd;
  });
  const [orderTimeHm, setOrderTimeHm] = useState(initialDt.hm);
  const [editWeekCode, setEditWeekCode] = useState("");
  const [weekCodeOverride, setWeekCodeOverride] = useState(globalWeek || DEFAULT_WEEK_CODE);
  const [weekDraft, setWeekDraft] = useState(globalWeek || DEFAULT_WEEK_CODE);
  const [weekInputErr, setWeekInputErr] = useState<string | null>(null);
  const [feeUsdStr, setFeeUsdStr] = useState("");
  const [loadOrderBusy, setLoadOrderBusy] = useState(false);
  const [loadedSourceCountry, setLoadedSourceCountry] = useState<OrderCountryCode | "">("");

  const weekCodeFromDate = useMemo(() => getWeekCodeForLocalDate(parseLocalDate(orderDateYmd)), [orderDateYmd]);
  const displayWeekCode = isEdit ? editWeekCode : weekCodeOverride;
  const weekCodeForSave = isEdit ? editWeekCode : weekCodeOverride;

  const weekOptions = useMemo(() => {
    const out: string[] = [];
    for (let n = 110; n <= 140; n++) out.push(toWeekCode(n));
    return out;
  }, []);

  const applyWeekNumber = useCallback(
    (num: number) => {
      const nextCode = toWeekCode(num);
      const diffWeeks = num - baseWeekNumber;
      const nextDate = addDays(baseDate, diffWeeks * 7);
      setOrderDateYmd(formatLocalYmd(nextDate));
      if (isEdit) setEditWeekCode(nextCode);
      else setWeekCodeOverride(nextCode);
      if (!isEdit) setWeekDraft(nextCode);
    },
    [baseDate, isEdit, baseWeekNumber],
  );

  useEffect(() => {
    if (isEdit) return;
    setWeekDraft(weekCodeOverride);
  }, [isEdit, weekCodeOverride]);

  const finalRate = useMemo(() => {
    const f = financial?.finalDollarRate ? Number(String(financial.finalDollarRate).replace(",", ".")) : NaN;
    return Number.isFinite(f) && f > 0 ? f : 3.5;
  }, [financial]);

  const commissionPct = useMemo(() => commissionPercentFromFinancial(financial), [financial]);

  const [orderNumberPreview, setOrderNumberPreview] = useState("…");

  /** שלושת שדות החיפוש + שורה ראשית — קוד משותף */
  const [codeStr, setCodeStr] = useState("");
  const [nameArStr, setNameArStr] = useState("");
  const [nameHeStr, setNameHeStr] = useState("");

  const [hits, setHits] = useState<CustomerSearchRow[]>([]);
  const [dropdownField, setDropdownField] = useState<ComboField | null>(null);
  const focusedComboRef = useRef<ComboField>("code");
  const skipSearchRef = useRef(false);
  const searchGenRef = useRef(0);

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchRow | null>(null);
  const [extras, setExtras] = useState<Awaited<ReturnType<typeof getCustomerOrderFormExtrasAction>>>(null);

  const [phoneStr, setPhoneStr] = useState("");
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(OrderStatus.OPEN);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.BANK_TRANSFER);
  const [paymentPointId, setPaymentPointId] = useState("");
  const [paymentPoints, setPaymentPoints] = useState<{ id: string; label: string }[]>([]);
  const [ppAddOpen, setPpAddOpen] = useState(false);
  const [ppAddName, setPpAddName] = useState("");
  const [ppAddBusy, setPpAddBusy] = useState(false);
  const [ppAddMsg, setPpAddMsg] = useState<string | null>(null);
  const [ppAddErr, setPpAddErr] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const [dealUsdStr, setDealUsdStr] = useState("");
  const [dealIlsStr, setDealIlsStr] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [orderCountries, setOrderCountries] = useState<OrderCountryCode[]>([]);
  const [sourceCountry, setSourceCountry] = useState<OrderCountryCode | "">(() =>
    target.mode === "create" ? (globalCountry as OrderCountryCode) : "",
  );

  useEffect(() => {
    void getSelectedCountriesForOrdersAction().then(setOrderCountries);
  }, []);

  useEffect(() => {
    void listPaymentPointsForOrderAction().then(setPaymentPoints);
  }, []);

  useEffect(() => {
    if (!ppAddMsg) return;
    const t = window.setTimeout(() => setPpAddMsg(null), 2200);
    return () => window.clearTimeout(t);
  }, [ppAddMsg]);

  const countrySelectOptions = useMemo(() => [...ORDER_COUNTRY_CODES] as OrderCountryCode[], []);

  useEffect(() => {
    if (orderCountries.length === 0) return;
    if (isEdit) return;
    setSourceCountry((cur) =>
      cur && orderCountries.includes(cur) ? cur : orderCountries[0] ?? (ORDER_COUNTRY_CODES[0] as OrderCountryCode),
    );
  }, [orderCountries, isEdit]);

  useEffect(() => {
    if (isEdit) return;
    void previewOrderNumberAction(weekCodeForSave).then((n) => setOrderNumberPreview(n || "—"));
  }, [weekCodeForSave, isEdit]);

  useEffect(() => {
    if (!isEdit) setLoadedSourceCountry("");
  }, [isEdit]);

  const editOrderId = isEdit ? target.orderId : "";

  useEffect(() => {
    if (!isEdit || !editOrderId) return;
    let cancelled = false;
    setLoadOrderBusy(true);
    setErr(null);
    void getOrderForWorkPanelAction(editOrderId).then((row) => {
      if (cancelled) return;
      setLoadOrderBusy(false);
      if (!row) {
        setErr("לא ניתן לטעון את ההזמנה");
        return;
      }
      skipSearchRef.current = true;
      setOrderDateYmd(row.orderDateYmd);
      setOrderTimeHm(row.orderTimeHm);
      setEditWeekCode(row.weekCode.trim() || getWeekCodeForLocalDate(parseLocalDate(row.orderDateYmd)));
      setOrderNumberPreview(row.orderNumber);
      setOrderStatus(row.status);
      setPaymentMethod(row.paymentMethod);
      setPaymentPointId(row.paymentPointId ?? "");
      setNotes(row.notes);
      setDealUsdStr(row.amountUsd);
      setFeeUsdStr(row.feeUsd);
      setDealIlsStr("");
      setSelectedCustomer({
        id: row.customerId,
        label: row.customerLabel,
        code: row.customerCode,
        customerType: null,
        city: null,
        phone: null,
      });
      setCodeStr(
        row.customerCode?.trim()
          ? row.customerCode.trim()
          : row.customerId.length > 14
            ? `${row.customerId.slice(0, 10)}…`
            : row.customerId,
      );
      setHits([]);
      setDropdownField(null);
      const coerced = coerceOrderCountryForForm(row.sourceCountry);
      setLoadedSourceCountry(coerced);
      setSourceCountry(coerced);
      queueMicrotask(() => {
        skipSearchRef.current = false;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isEdit, editOrderId, financial?.finalDollarRate]);

  useEffect(() => {
    const id = selectedCustomer?.id;
    if (!id) {
      setExtras(null);
      setPhoneStr("");
      return;
    }
    let cancelled = false;
    void getCustomerOrderFormExtrasAction(id).then((ex) => {
      if (!cancelled && ex) {
        skipSearchRef.current = true;
        setExtras(ex);
        setNameArStr(ex.nameAr ?? "");
        setNameHeStr(ex.nameHe ?? "");
        setPhoneStr(ex.phone ?? "");
        queueMicrotask(() => {
          skipSearchRef.current = false;
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer?.id]);

  const openCustomerCard = useCallback(() => {
    if (!selectedCustomer) return;
    openWindow({
      type: "customerCard",
      props: {
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.label,
        initialTab: "details",
      },
    });
  }, [openWindow, selectedCustomer]);

  const dealUsdNum = useMemo(() => parseNum(dealUsdStr), [dealUsdStr]);
  const dealIlsNum = useMemo(() => parseNum(dealIlsStr), [dealIlsStr]);

  const safeRate = useMemo(() => (Number.isFinite(finalRate) && finalRate > 0 ? finalRate : 0), [finalRate]);
  const ilsInput = useMemo(() => (Number.isFinite(dealIlsNum) && dealIlsNum > 0 ? dealIlsNum : 0), [dealIlsNum]);
  const usdInput = useMemo(() => (Number.isFinite(dealUsdNum) && dealUsdNum > 0 ? dealUsdNum : 0), [dealUsdNum]);

  /** שווי תצוגה בלבד (לא מסנכרן שדות) */
  const eqUsdFromIls = useMemo(() => (safeRate > 0 ? ilsInput / safeRate : 0), [ilsInput, safeRate]);
  const eqIlsFromUsd = useMemo(() => (safeRate > 0 ? usdInput * safeRate : 0), [usdInput, safeRate]);

  /** הסכום הכולל (עסקה) לפי שני השדות */
  const dealUsdTotal = useMemo(() => (safeRate > 0 ? usdInput + ilsInput / safeRate : usdInput), [usdInput, ilsInput, safeRate]);
  const dealIlsTotal = useMemo(() => (safeRate > 0 ? ilsInput + usdInput * safeRate : ilsInput), [ilsInput, usdInput, safeRate]);

  const commissionUsdCalc = useMemo(() => {
    if (!Number.isFinite(dealUsdTotal) || dealUsdTotal <= 0) return 0;
    return roundMoney2(dealUsdTotal * (commissionPct / 100));
  }, [dealUsdTotal, commissionPct]);

  const commissionIlsCalc = useMemo(() => {
    if (!Number.isFinite(dealIlsTotal) || dealIlsTotal <= 0) return 0;
    return roundMoney2(dealIlsTotal * (commissionPct / 100));
  }, [dealIlsTotal, commissionPct]);

  const feeUsdNumEdit = useMemo(() => {
    const f = parseNum(feeUsdStr);
    return Number.isFinite(f) && f >= 0 ? f : 0;
  }, [feeUsdStr]);

  const commissionUsdEffective = useMemo(
    () => (isEdit ? feeUsdNumEdit : commissionUsdCalc),
    [isEdit, feeUsdNumEdit, commissionUsdCalc],
  );

  const commissionIlsEffective = useMemo(
    () => (isEdit ? roundMoney2(feeUsdNumEdit * finalRate) : commissionIlsCalc),
    [isEdit, feeUsdNumEdit, finalRate, commissionIlsCalc],
  );

  const totalBeforeVatIls = useMemo(() => {
    if (!Number.isFinite(dealIlsTotal) || dealIlsTotal <= 0) return 0;
    return roundMoney2(dealIlsTotal + commissionIlsEffective);
  }, [dealIlsTotal, commissionIlsEffective]);

  const vatAmountIls = useMemo(() => roundMoney2(totalBeforeVatIls * VAT_FRACTION), [totalBeforeVatIls]);

  const finalTotalIls = useMemo(() => roundMoney2(totalBeforeVatIls + vatAmountIls), [totalBeforeVatIls, vatAmountIls]);

  const vatAmountUsd = useMemo(() => (safeRate > 0 ? roundMoney2(vatAmountIls / safeRate) : 0), [vatAmountIls, safeRate]);

  const totalUsdCalc = useMemo(() => {
    if (!Number.isFinite(dealUsdTotal) || dealUsdTotal <= 0) return 0;
    return roundMoney2(dealUsdTotal + commissionUsdEffective);
  }, [dealUsdTotal, commissionUsdEffective]);

  const pickCustomer = useCallback((row: CustomerSearchRow) => {
    skipSearchRef.current = true;
    setSelectedCustomer(row);
    setCodeStr(customerDisplayCode(row));
    setHits([]);
    setDropdownField(null);
    window.setTimeout(() => {
      skipSearchRef.current = false;
    }, 0);
  }, []);

  /** חיפוש כשמשנים קלט באחד משלושת השדות — לפי השדה במיקוד */
  useEffect(() => {
    if (skipSearchRef.current) return;
    const field = focusedComboRef.current;
    const q = field === "code" ? codeStr : field === "nameAr" ? nameArStr : nameHeStr;
    const trimmed = q.trim();
    if (!trimmed) {
      setHits([]);
      return;
    }
    const gen = ++searchGenRef.current;
    const t = window.setTimeout(() => {
      void (async () => {
        const rows = await searchCustomersForOrderAction(trimmed);
        if (searchGenRef.current !== gen) return;
        setHits(rows);
        setDropdownField(field);
      })();
    }, 200);
    return () => window.clearTimeout(t);
  }, [codeStr, nameArStr, nameHeStr]);

  const openFullList = useCallback(async (field: ComboField) => {
    focusedComboRef.current = field;
    const rows = await listCustomersForOrderQuickPickAction();
    setHits(rows);
    setDropdownField(field);
  }, []);

  async function resolveExactCode() {
    setErr(null);
    const raw = codeStr.trim();
    if (!raw) {
      setErr("הזינו קוד לקוח");
      return;
    }
    const row = await resolveCustomerForCaptureAction(raw);
    if (row) {
      pickCustomer(row);
      return;
    }
    const found = await searchCustomersForOrderAction(raw);
    const exact =
      found.find((h) => (h.code || "").trim().toLowerCase() === raw.toLowerCase()) ??
      found.find((h) => h.label.trim().toLowerCase() === raw.toLowerCase());
    if (exact) pickCustomer(exact);
    else setErr("לקוח לא נמצא");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;

    let cust = selectedCustomer;
    if (!cust && codeStr.trim()) {
      const row = await resolveCustomerForCaptureAction(codeStr.trim());
      if (row) {
        pickCustomer(row);
        cust = row;
      }
    }
    if (!cust) {
      setErr("יש לבחור לקוח באחד משדות החיפוש");
      return;
    }

    if (!Number.isFinite(dealUsdTotal) || dealUsdTotal <= 0) {
      setErr("יש להזין סכום עסקה (₪ או $)");
      return;
    }
    const countryForSave =
      coerceOrderCountryForForm(sourceCountry) ||
      (isEdit ? coerceOrderCountryForForm(loadedSourceCountry) : "");
    if (!countryForSave) {
      setErr("יש לבחור מדינת מקור");
      return;
    }

    if (isEdit && (!canEditOrders || !editOrderId)) {
      setErr("אין הרשאה לעריכה");
      return;
    }
    if (!isEdit && !canCreateOrders) {
      setErr("אין הרשאה ליצירת הזמנה");
      return;
    }

    try {
      setIsSaving(true);
      setErr(null);

      if (isEdit) {
        const feeStr = commissionUsdEffective.toFixed(2);
        const res = await runWithLoading(
          () =>
            updateOrderWorkPanelAction({
              orderId: editOrderId,
              weekCode: weekCodeForSave,
              orderDateYmd,
              orderTimeHm,
              customerId: cust.id,
              amountUsd: roundMoney2(dealUsdTotal).toFixed(2),
              feeUsd: feeStr,
              paymentMethod,
              status: orderStatus,
              notes: notes.trim() || undefined,
              paymentPointId: paymentPointId.trim() || null,
              paymentLines: undefined,
              sourceCountry: countryForSave,
            }),
          "שומר נתונים...",
        );
        if (!res.ok) throw new Error(res.error);
        onToast("ההזמנה עודכנה בהצלחה!");
      } else {
        const feeStr = commissionUsdCalc.toFixed(2);
        const res = await runWithLoading(
          () =>
            captureOrderAction({
              weekCode: weekCodeForSave,
              orderDateYmd,
              orderTimeHm,
              customerId: cust.id,
              amountUsd: roundMoney2(dealUsdTotal).toFixed(2),
              feeUsd: feeStr,
              paymentMethod,
              status: orderStatus,
              notes: notes.trim() || undefined,
              paymentPointId: paymentPointId.trim() || null,
              vatPercent: String(Math.round(VAT_FRACTION * 100)),
              paymentLines: undefined,
              sourceCountry: countryForSave,
            }),
          "שומר נתונים...",
        );
        if (!res.ok) throw new Error(res.error);
        onToast("הזמנה נוצרה בהצלחה!");
      }

      await router.refresh();
      onSaved?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "שגיאה בשמירה";
      setErr(msg);
      onToast("שגיאה בשמירה");
    } finally {
      setIsSaving(false);
    }
  }

  const dateTimeDisplay = `${orderDateYmd.replace(/-/g, "/")} ${orderTimeHm}`;

  const customerMiniLine = useMemo(() => {
    if (!selectedCustomer || !extras) return "";
    const name = (nameHeStr || nameArStr || selectedCustomer.label).trim();
    const phone = (phoneStr || extras.phone || "").trim();
    const place = [extras.city, extras.address].filter(Boolean).join(" · ");
    const parts = [`👤 ${name}`, phone, place].filter((p) => p.length > 0);
    return parts.join(" | ");
  }, [selectedCustomer, extras, nameHeStr, nameArStr, phoneStr]);

  function blurCloseDropdown() {
    window.setTimeout(() => setDropdownField(null), 180);
  }

  const closeCustomerDropdown = useCallback(() => {
    setDropdownField(null);
    setHits([]);
  }, []);

  if (target.mode === "create" && !canCreateOrders) return null;
  if (target.mode === "edit" && !canEditOrders) return null;

  if (isEdit && loadOrderBusy) {
    return (
      <div className="adm-order-create-legacy-wrap">
        <p className="adm-order-work-panel-loading">טוען…</p>
      </div>
    );
  }

  const statusOptions = isEdit ? EDIT_ORDER_STATUS_OPTIONS : CREATE_ORDER_STATUS_OPTIONS;

  return (
    <div className="adm-order-create-legacy-wrap">
      <form className="adm-order-create adm-order-create--legacy adm-capture-order-shell" onSubmit={onSubmit} dir="rtl">
        {err ? <div className="adm-error adm-error--compact adm-oc-legacy-err">{err}</div> : null}

        <div className="modal-container">
          <div className="modal-main">
            <Card>
              <h3 className="ds-capture-section-title">פרטים כלליים</h3>
        {/* שורת עליונה — קטנה, מימין */}
        <div className="adm-oc-legacy-topbar">
          <span className="adm-oc-legacy-topbar-item">
            <label className="adm-oc-legacy-micro-label">{dateTimeDisplay}</label>
          </span>
          <span className="adm-oc-legacy-topbar-item">
            <label className="adm-oc-legacy-micro-label">שבוע</label>
            <div className="adm-oc-week-row" dir="ltr">
              <button
                type="button"
                className="adm-oc-week-arrow"
                disabled={isSaving}
                aria-label="שבוע קודם"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const cur = parseWeekNumber(isEdit ? editWeekCode : weekDraft) ?? baseWeekNumber;
                  applyWeekNumber(cur - 1);
                  setWeekInputErr(null);
                }}
              >
                ◀
              </button>
              <input
                id={idp("week-inp")}
                type="text"
                className={weekInputErr ? "adm-oc-legacy-top-inp adm-oc-week-inp--err" : "adm-oc-legacy-top-inp"}
                value={isEdit ? editWeekCode : weekDraft}
                dir="ltr"
                list={idp("week-list")}
                disabled={isSaving}
                title={weekInputErr || undefined}
                onChange={(e) => {
                  const raw = e.target.value;
                  const up = raw.trim().toUpperCase();
                  if (isEdit) setEditWeekCode(up);
                  else setWeekDraft(up);

                  const num = parseWeekNumber(up);
                  if (num == null) {
                    setWeekInputErr(up ? "שבוע לא תקין" : null);
                    return;
                  }
                  setWeekInputErr(null);
                  applyWeekNumber(num);
                }}
                onBlur={() => {
                  const curRaw = (isEdit ? editWeekCode : weekDraft).trim().toUpperCase();
                  const num = parseWeekNumber(curRaw);
                  if (num == null) {
                    setWeekInputErr(null);
                    if (isEdit) setEditWeekCode(editWeekCode.trim() || globalWeek);
                    else setWeekDraft(weekCodeOverride);
                    return;
                  }
                  const code = toWeekCode(num);
                  if (isEdit) setEditWeekCode(code);
                  else setWeekDraft(code);
                }}
              />
              <button
                type="button"
                className="adm-oc-week-arrow"
                disabled={isSaving}
                aria-label="שבוע הבא"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const cur = parseWeekNumber(isEdit ? editWeekCode : weekDraft) ?? baseWeekNumber;
                  applyWeekNumber(cur + 1);
                  setWeekInputErr(null);
                }}
              >
                ▶
              </button>
              <button
                type="button"
                className="adm-oc-week-dd"
                disabled={isSaving}
                aria-label="רשימת שבועות"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const el = document.getElementById(idp("week-inp")) as HTMLInputElement | null;
                  el?.focus();
                }}
              >
                ▼
              </button>
              <datalist id={idp("week-list")}>
                {weekOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </span>
          <span className="adm-oc-legacy-topbar-item">
            <label htmlFor={idp("country")} className="adm-oc-legacy-micro-label">
              מדינה
            </label>
            <select
              id={idp("country")}
              className="adm-oc-legacy-top-sel"
              value={sourceCountry}
              disabled={isSaving}
              onFocus={closeCustomerDropdown}
              onChange={(e) => {
                const v = e.target.value as OrderCountryCode | "";
                setSourceCountry(v);
              }}
            >
              <option value="" disabled>
                —
              </option>
              {countrySelectOptions.map((c) => (
                <option key={c} value={c}>
                  {orderCountryLabel(c)}
                </option>
              ))}
            </select>
          </span>
          <span className="adm-oc-legacy-topbar-item">
            <label className="adm-oc-legacy-micro-label">שער דולר</label>
            <input type="text" readOnly className="adm-oc-legacy-top-inp" value={finalRate.toFixed(2)} dir="ltr" title="שער דולר סופי מהגדרות" />
          </span>
          <span className="adm-oc-legacy-topbar-item">
            <label className="adm-oc-legacy-micro-label">עמלה %</label>
            <input
              type="text"
              readOnly
              className="adm-oc-legacy-top-inp"
              value={commissionPct.toFixed(2)}
              dir="ltr"
              title="אחוז עמלה מהגדרות כספים"
            />
          </span>
        </div>

        {/* שורה ראשית — גדולה */}
        <div className="adm-oc-legacy-mainrow">
          <div className="adm-oc-legacy-main-field">
            <label htmlFor={idp("ordnum")}>מספר הזמנה</label>
            <input id={idp("ordnum")} type="text" readOnly className="adm-oc-legacy-main-ro" value={orderNumberPreview} dir="ltr" />
          </div>
          <div className={`adm-oc-legacy-main-field${dropdownField === "code" && hits.length > 0 ? " adm-oc-legacy-main-field--open" : ""}`}>
            <label htmlFor={idp("code-main")}>קוד לקוח</label>
            <div className="adm-oc-legacy-main-code-with-icon">
              <div className="adm-oc-legacy-main-code-wrap">
                <input
                  id={idp("code-main")}
                  type="text"
                  autoComplete="off"
                  className="adm-oc-legacy-main-inp"
                  disabled={isSaving}
                  dir="ltr"
                  value={codeStr}
                  onChange={(e) => {
                    setCodeStr(e.target.value);
                    setSelectedCustomer(null);
                  }}
                  onFocus={() => {
                    focusedComboRef.current = "code";
                  }}
                  onBlur={() => {
                    blurCloseDropdown();
                    void resolveExactCode();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void resolveExactCode();
                    }
                  }}
                />
                <button
                  type="button"
                  className="adm-oc-legacy-main-arrow"
                  disabled={isSaving}
                  aria-label="רשימה מלאה"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void openFullList("code")}
                >
                  ▼
                </button>
                {dropdownField === "code" && hits.length > 0 ? (
                  <ul className="adm-oc-legacy-dd adm-oc-legacy-dd--main" role="listbox">
                    {hits.map((row) => (
                      <li key={row.id}>
                        <button type="button" className="adm-oc-legacy-dd-item" onMouseDown={() => pickCustomer(row)}>
                          <span>{row.label}</span>
                          <span dir="ltr" className="adm-oc-legacy-dd-meta">
                            {customerDisplayCode(row)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button
                type="button"
                className="adm-oc-legacy-customer-card-btn"
                disabled={isSaving || !selectedCustomer}
                title="פתח כרטסת לקוח"
                aria-label="פתח כרטסת לקוח"
                onClick={openCustomerCard}
              >
                <User size={16} strokeWidth={2} aria-hidden />
              </button>
            </div>
          </div>
          <div className="adm-oc-legacy-main-field">
            <label htmlFor={idp("idx")}>אינדקס</label>
            <input
              id={idp("idx")}
              type="text"
              readOnly
              className="adm-oc-legacy-main-ro"
              value={extras?.indexLabel ?? ""}
              dir="ltr"
            />
          </div>
        </div>

            <div className="adm-oc-legacy-center">
            {customerMiniLine ? (
              <div className="adm-oc-legacy-customer-mini" dir="rtl">
                <span className="adm-oc-legacy-customer-mini-text">{customerMiniLine}</span>
                {extras ? (
                  <span dir="ltr" className={`adm-oc-legacy-customer-mini-bal${extras.balanceUsdNegative ? " adm-oc-legacy-customer-mini-bal--neg" : ""}`}>
                    יתרה ${extras.balanceUsdDisplay}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="adm-oc-legacy-search-row">
              {/* ערבית */}
              <div className="adm-oc-legacy-field-wrap">
                <label htmlFor={idp("c-ar")}>שם ערבית</label>
                <div className="adm-oc-legacy-input-row">
                  <input
                    id={idp("c-ar")}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isSaving}
                    dir="rtl"
                    className="adm-oc-legacy-combo-inp"
                    value={nameArStr}
                    onChange={(e) => {
                      setNameArStr(e.target.value);
                      setSelectedCustomer(null);
                    }}
                    onFocus={() => {
                      focusedComboRef.current = "nameAr";
                    }}
                    onBlur={blurCloseDropdown}
                  />
                  <button
                    type="button"
                    data-oc-arrow
                    className="adm-oc-legacy-arrow"
                    disabled={isSaving}
                    aria-label="רשימה מלאה"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void openFullList("nameAr")}
                  >
                    ▼
                  </button>
                </div>
                {dropdownField === "nameAr" && hits.length > 0 ? (
                  <ul className="adm-oc-legacy-dd" role="listbox">
                    {hits.map((row) => (
                      <li key={row.id}>
                        <button type="button" className="adm-oc-legacy-dd-item" onMouseDown={() => pickCustomer(row)}>
                          <span>{row.label}</span>
                          <span dir="ltr" className="adm-oc-legacy-dd-meta">
                            {customerDisplayCode(row)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {/* עברית */}
              <div className="adm-oc-legacy-field-wrap">
                <div className="adm-oc-legacy-label-with-action">
                  <label htmlFor={idp("c-he")}>שם עברית</label>
                  <button
                    type="button"
                    className="adm-oc-legacy-customer-card-btn adm-oc-legacy-customer-card-btn--inline"
                    disabled={isSaving || !selectedCustomer}
                    title="פתח כרטסת לקוח"
                    aria-label="פתח כרטסת לקוח"
                    onClick={openCustomerCard}
                  >
                    <User size={16} strokeWidth={2} aria-hidden />
                  </button>
                </div>
                <div className="adm-oc-legacy-input-row">
                  <input
                    id={idp("c-he")}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isSaving}
                    dir="rtl"
                    className="adm-oc-legacy-combo-inp"
                    value={nameHeStr}
                    onChange={(e) => {
                      setNameHeStr(e.target.value);
                      setSelectedCustomer(null);
                    }}
                    onFocus={() => {
                      focusedComboRef.current = "nameHe";
                    }}
                    onBlur={blurCloseDropdown}
                  />
                  <button
                    type="button"
                    data-oc-arrow
                    className="adm-oc-legacy-arrow"
                    disabled={isSaving}
                    aria-label="רשימה מלאה"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void openFullList("nameHe")}
                  >
                    ▼
                  </button>
                </div>
                {dropdownField === "nameHe" && hits.length > 0 ? (
                  <ul className="adm-oc-legacy-dd" role="listbox">
                    {hits.map((row) => (
                      <li key={row.id}>
                        <button type="button" className="adm-oc-legacy-dd-item" onMouseDown={() => pickCustomer(row)}>
                          <span>{row.label}</span>
                          <span dir="ltr" className="adm-oc-legacy-dd-meta">
                            {customerDisplayCode(row)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {/* טלפון */}
              <div className="adm-oc-legacy-field-wrap">
                <label htmlFor={idp("phone-ro")}>טלפון</label>
                <input
                  id={idp("phone-ro")}
                  type="text"
                  readOnly
                  className="adm-oc-legacy-phone-ro"
                  value={phoneStr}
                  dir="ltr"
                  placeholder="—"
                  title="מתמלא אוטומטית לפי הלקוח"
                />
              </div>
            </div>

            <div className="adm-oc-legacy-notes">
              <label htmlFor={idp("notes")}>הערות</label>
              <textarea
                id={idp("notes")}
                className="adm-oc-legacy-notes-ta"
                rows={3}
                disabled={isSaving}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="הערות להזמנה…"
              />
            </div>
          </div>
            </Card>

            <Card className="adm-oc-pay-card">
              <h3 className="ds-capture-section-title">פרטי תשלום</h3>
              <aside className="adm-oc-legacy-side" aria-label="סטטוס ותשלום">
                <div className="adm-oc-legacy-side-field">
                  <label htmlFor={idp("ord-st")}>סטטוס הזמנה</label>
                  <select
                    id={idp("ord-st")}
                    className="adm-oc-legacy-side-sel"
                    disabled={isSaving}
                    value={orderStatus}
                    onFocus={closeCustomerDropdown}
                    onChange={(e) => setOrderStatus(e.target.value as OrderStatus)}
                  >
                    {statusOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="adm-oc-legacy-side-field">
                  <label htmlFor={idp("pay-pt")}>מקום תשלום</label>
                  <select
                    id={idp("pay-pt")}
                    className="adm-oc-legacy-side-sel"
                    disabled={isSaving}
                    value={paymentPointId}
                    onFocus={closeCustomerDropdown}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__ADD__") {
                        setPpAddErr(null);
                        setPpAddMsg(null);
                        setPpAddName("");
                        setPpAddOpen(true);
                        return;
                      }
                      setPaymentPointId(v);
                    }}
                  >
                    {paymentPoints.length === 0 ? (
                      <option value="" disabled>
                        אין מקומות עדיין
                      </option>
                    ) : (
                      <option value="">—</option>
                    )}
                    {paymentPoints.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    <option value="__ADD__">+ הוספת מקום</option>
                  </select>
                  {ppAddMsg ? <div className="adm-oc-inline-msg">{ppAddMsg}</div> : null}
                  {ppAddErr ? <div className="adm-oc-inline-err">{ppAddErr}</div> : null}
                  {ppAddOpen ? (
                    <div className="adm-oc-addpoint">
                      <label className="adm-oc-addpoint-lbl">
                        הוספת מקום חדש
                        <input
                          type="text"
                          className="adm-oc-legacy-side-sel"
                          value={ppAddName}
                          disabled={ppAddBusy}
                          onChange={(e) => setPpAddName(e.target.value)}
                          placeholder="שם מקום..."
                        />
                      </label>
                      <div className="adm-oc-addpoint-actions">
                        <button
                          type="button"
                          className={`adm-btn adm-btn--primary adm-btn--dense${ppAddBusy ? " loading" : ""}`}
                          disabled={ppAddBusy}
                          onClick={() => {
                            if (ppAddBusy) return;
                            const name = ppAddName.trim();
                            if (!name) {
                              setPpAddErr("יש להזין שם מקום");
                              return;
                            }
                            setPpAddBusy(true);
                            setPpAddErr(null);
                            void createPaymentPointForOrderAction({ pointName: name }).then((res) => {
                              setPpAddBusy(false);
                              if (!res.ok) {
                                setPpAddErr(res.error);
                                return;
                              }
                              setPaymentPoints((cur) => {
                                const next = [...cur, res.point];
                                next.sort((a, b) => a.label.localeCompare(b.label, "he"));
                                return next;
                              });
                              setPaymentPointId(res.point.id);
                              setPpAddMsg("נוסף מקום בהצלחה");
                              setPpAddOpen(false);
                              setPpAddName("");
                            });
                          }}
                        >
                          {ppAddBusy ? "שומר…" : "שמירה"}
                        </button>
                        <button
                          type="button"
                          className="adm-btn adm-btn--ghost adm-btn--dense"
                          disabled={ppAddBusy}
                          onClick={() => {
                            setPpAddOpen(false);
                            setPpAddName("");
                            setPpAddErr(null);
                          }}
                        >
                          ביטול
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="adm-oc-legacy-side-field">
                  <label htmlFor={idp("pay-m")}>צורת תשלום</label>
                  <select
                    id={idp("pay-m")}
                    className="adm-oc-legacy-side-sel"
                    disabled={isSaving}
                    value={paymentMethod}
                    onFocus={closeCustomerDropdown}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  >
                    {ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </aside>
            </Card>
          </div>

          <div className="modal-summary" dir="ltr">
            <Card className="summary-info adm-oc-legacy-card">
              <div className="adm-oc-card-title">₪ שקלים</div>
              <div className="adm-field adm-oc-field adm-oc-legacy-fin-field">
                <label htmlFor={idp("dils")}>סכום בשקלים</label>
                <input
                  id={idp("dils")}
                  type="text"
                  inputMode="decimal"
                  className="adm-oc-inp adm-oc-legacy-fin-inp"
                  disabled={isSaving}
                  dir="ltr"
                  value={dealIlsStr}
                  placeholder="הקלד סכום..."
                  onChange={(e) => {
                    const v = e.target.value;
                    setDealIlsStr(v);
                  }}
                />
              </div>
              <div className="adm-oc-xrate" dir="rtl" aria-live="polite">
                <span className="adm-oc-xrate-lbl">שווי בדולרים</span>
                <span className="adm-oc-xrate-val" dir="ltr">
                  ${roundMoney2(eqUsdFromIls).toFixed(2)}
                </span>
              </div>
              <div className="adm-oc-line">
                <span>עמלה</span>
                <span dir="ltr">{commissionIlsEffective.toFixed(2)} ₪</span>
              </div>
              <div className="adm-oc-line">
                <span>סה״כ לפני מע״מ</span>
                <span dir="ltr">{totalBeforeVatIls.toFixed(2)} ₪</span>
              </div>
              <div className="adm-oc-line">
                <span>מע״מ ({Math.round(VAT_FRACTION * 100)}%)</span>
                <span dir="ltr">
                  {vatAmountIls.toFixed(2)} ₪ / ${vatAmountUsd.toFixed(2)}
                </span>
              </div>
              <div className="adm-oc-line adm-oc-line--total">
                <span>סה״כ סופי</span>
                <span dir="ltr">{finalTotalIls.toFixed(2)} ₪</span>
              </div>
            </Card>

            <Card className="summary-success adm-oc-legacy-card">
              <div className="adm-oc-card-title">$ דולרים</div>
              <div className="adm-field adm-oc-field adm-oc-legacy-fin-field">
                <label htmlFor={idp("dusd")}>סכום בדולר</label>
                <input
                  id={idp("dusd")}
                  type="text"
                  inputMode="decimal"
                  className="adm-oc-inp adm-oc-legacy-fin-inp"
                  disabled={isSaving}
                  dir="ltr"
                  value={dealUsdStr}
                  placeholder="הקלד סכום..."
                  onChange={(e) => {
                    const v = e.target.value;
                    setDealUsdStr(v);
                  }}
                />
              </div>
              <div className="adm-oc-xrate" dir="rtl" aria-live="polite">
                <span className="adm-oc-xrate-lbl">שווי בשקלים</span>
                <span className="adm-oc-xrate-val" dir="ltr">
                  ₪{roundMoney2(eqIlsFromUsd).toFixed(2)}
                </span>
              </div>
              <div className="adm-oc-line">
                <span>עמלה</span>
                <span dir="ltr">{commissionUsdEffective.toFixed(2)} $</span>
              </div>
              <div className="adm-oc-line adm-oc-line--total">
                <span>סה״כ</span>
                <span dir="ltr">{totalUsdCalc.toFixed(2)} $</span>
              </div>
            </Card>
          </div>
        </div>

        <div className="adm-modal-actions adm-modal-actions--capture adm-oc-legacy-actions">
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" disabled={isSaving} onClick={onClose}>
            ביטול
          </button>
          <button
            type="submit"
            className={`adm-btn adm-btn--primary adm-btn--dense${isSaving ? " loading" : ""}`}
            disabled={isSaving || (isEdit ? !canEditOrders : !canCreateOrders)}
          >
            {isSaving ? "שומר…" : isEdit ? "עדכון" : "שמירה"}
          </button>
        </div>
      </form>
    </div>
  );
}
