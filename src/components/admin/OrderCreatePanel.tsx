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
import Card from "@/components/ui/Card";
import type { OrderCaptureWindowProps } from "@/lib/admin-windows";
import { ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS } from "@/lib/order-capture-payment-methods";
import { orderCountryLabel, ORDER_COUNTRY_CODES, coerceOrderCountryForForm, type OrderCountryCode } from "@/lib/order-countries";
import type { SerializedFinancial } from "@/lib/financial-settings";
import {
  formatLocalHm,
  formatLocalYmd,
  getWeekCodeForLocalDate,
  parseLocalDate,
} from "@/lib/work-week";

const VAT_FRACTION = 0.17;

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
  const idp = (s: string) => `${windowId}-${s}`;

  const isEdit = target.mode === "edit";

  const initialDt = useMemo(() => {
    const d = new Date();
    return { ymd: formatLocalYmd(d), hm: formatLocalHm(d) };
  }, []);
  const [orderDateYmd, setOrderDateYmd] = useState(initialDt.ymd);
  const [orderTimeHm, setOrderTimeHm] = useState(initialDt.hm);
  const [editWeekCode, setEditWeekCode] = useState("");
  const [feeUsdStr, setFeeUsdStr] = useState("");
  const [loadOrderBusy, setLoadOrderBusy] = useState(false);
  const [loadedSourceCountry, setLoadedSourceCountry] = useState<OrderCountryCode | "">("");

  const weekCodeFromDate = useMemo(() => getWeekCodeForLocalDate(parseLocalDate(orderDateYmd)), [orderDateYmd]);
  const displayWeekCode = isEdit ? editWeekCode : weekCodeFromDate;
  const weekCodeForSave = isEdit ? editWeekCode : weekCodeFromDate;

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
  const [notes, setNotes] = useState("");

  const [dealUsdStr, setDealUsdStr] = useState("");
  const [dealIlsStr, setDealIlsStr] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [orderCountries, setOrderCountries] = useState<OrderCountryCode[]>([]);
  const [sourceCountry, setSourceCountry] = useState<OrderCountryCode | "">(() =>
    target.mode === "create" ? (ORDER_COUNTRY_CODES[0] as OrderCountryCode) : "",
  );

  useEffect(() => {
    void getSelectedCountriesForOrdersAction().then(setOrderCountries);
  }, []);

  useEffect(() => {
    void listPaymentPointsForOrderAction().then(setPaymentPoints);
  }, []);

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
    void previewOrderNumberAction(weekCodeFromDate).then((n) => setOrderNumberPreview(n || "—"));
  }, [weekCodeFromDate, isEdit]);

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
      const deal = parseNum(row.amountUsd);
      const r = financial?.finalDollarRate ? Number(String(financial.finalDollarRate).replace(",", ".")) : NaN;
      const rate = Number.isFinite(r) && r > 0 ? r : 3.5;
      if (Number.isFinite(deal) && deal > 0) {
        setDealIlsStr(roundMoney2(deal * rate).toFixed(2));
      }
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

  const commissionUsdCalc = useMemo(() => {
    if (!Number.isFinite(dealUsdNum) || dealUsdNum <= 0) return 0;
    return roundMoney2(dealUsdNum * (commissionPct / 100));
  }, [dealUsdNum, commissionPct]);

  const commissionIlsCalc = useMemo(() => {
    if (!Number.isFinite(dealIlsNum) || dealIlsNum <= 0) return 0;
    return roundMoney2(dealIlsNum * (commissionPct / 100));
  }, [dealIlsNum, commissionPct]);

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
    if (!Number.isFinite(dealIlsNum) || dealIlsNum <= 0) return 0;
    return roundMoney2(dealIlsNum + commissionIlsEffective);
  }, [dealIlsNum, commissionIlsEffective]);

  const vatAmountIls = useMemo(() => roundMoney2(totalBeforeVatIls * VAT_FRACTION), [totalBeforeVatIls]);

  const finalTotalIls = useMemo(() => roundMoney2(totalBeforeVatIls + vatAmountIls), [totalBeforeVatIls, vatAmountIls]);

  const totalUsdCalc = useMemo(() => {
    if (!Number.isFinite(dealUsdNum) || dealUsdNum <= 0) return 0;
    return roundMoney2(dealUsdNum + commissionUsdEffective);
  }, [dealUsdNum, commissionUsdEffective]);

  const syncIlsFromUsd = useCallback(
    (usdRaw: string) => {
      const u = parseNum(usdRaw);
      if (!Number.isFinite(u) || u <= 0 || !Number.isFinite(finalRate) || finalRate <= 0) {
        setDealIlsStr("");
        return;
      }
      setDealIlsStr(roundMoney2(u * finalRate).toFixed(2));
    },
    [finalRate],
  );

  const syncUsdFromIls = useCallback(
    (ilsRaw: string) => {
      const ils = parseNum(ilsRaw);
      if (!Number.isFinite(ils) || ils <= 0 || !Number.isFinite(finalRate) || finalRate <= 0) {
        setDealUsdStr("");
        return;
      }
      setDealUsdStr(roundMoney2(ils / finalRate).toFixed(2));
    },
    [finalRate],
  );

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

    const deal = parseNum(dealUsdStr);
    if (!Number.isFinite(deal) || deal <= 0) {
      setErr("יש להזין סכום עסקה בדולר (חיובי)");
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
              amountUsd: dealUsdStr.trim(),
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
              amountUsd: dealUsdStr.trim(),
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
            <input type="text" readOnly className="adm-oc-legacy-top-inp" value={displayWeekCode} dir="ltr" />
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

            <Card>
              <h3 className="ds-capture-section-title">פרטי תשלום</h3>
              <aside className="adm-oc-legacy-side" aria-label="סטטוס ותשלום">
                <div className="adm-oc-legacy-side-field">
                  <label htmlFor={idp("ord-st")}>סטטוס הזמנה</label>
                  <select
                    id={idp("ord-st")}
                    className="adm-oc-legacy-side-sel"
                    disabled={isSaving}
                    value={orderStatus}
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
                    onChange={(e) => setPaymentPointId(e.target.value)}
                  >
                    <option value="">—</option>
                    {paymentPoints.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="adm-oc-legacy-side-field">
                  <label htmlFor={idp("pay-m")}>צורת תשלום</label>
                  <select
                    id={idp("pay-m")}
                    className="adm-oc-legacy-side-sel"
                    disabled={isSaving}
                    value={paymentMethod}
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
                <label htmlFor={idp("dils")}>עסקה</label>
                <input
                  id={idp("dils")}
                  type="text"
                  inputMode="decimal"
                  className="adm-oc-inp adm-oc-legacy-fin-inp"
                  disabled={isSaving}
                  dir="ltr"
                  value={dealIlsStr}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDealIlsStr(v);
                    syncUsdFromIls(v);
                  }}
                />
              </div>
              <div className="adm-oc-line">
                <span>עמלה</span>
                <span dir="ltr">{commissionIlsEffective.toFixed(2)}</span>
              </div>
              <div className="adm-oc-line">
                <span>סה״כ לפני מע״מ</span>
                <span dir="ltr">{totalBeforeVatIls.toFixed(2)}</span>
              </div>
              <div className="adm-oc-line">
                <span>מע״מ ({Math.round(VAT_FRACTION * 100)}%)</span>
                <span dir="ltr">{vatAmountIls.toFixed(2)}</span>
              </div>
              <div className="adm-oc-line adm-oc-line--total">
                <span>סה״כ סופי</span>
                <span dir="ltr">{finalTotalIls.toFixed(2)}</span>
              </div>
            </Card>

            <Card className="summary-success adm-oc-legacy-card">
              <div className="adm-oc-card-title">$ דולרים</div>
              <div className="adm-field adm-oc-field adm-oc-legacy-fin-field">
                <label htmlFor={idp("dusd")}>עסקה</label>
                <input
                  id={idp("dusd")}
                  type="text"
                  inputMode="decimal"
                  className="adm-oc-inp adm-oc-legacy-fin-inp"
                  disabled={isSaving}
                  dir="ltr"
                  value={dealUsdStr}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDealUsdStr(v);
                    syncIlsFromUsd(v);
                  }}
                />
              </div>
              <div className="adm-oc-line">
                <span>עמלה</span>
                <span dir="ltr">{commissionUsdEffective.toFixed(2)}</span>
              </div>
              <div className="adm-oc-line adm-oc-line--total">
                <span>סה״כ</span>
                <span dir="ltr">{totalUsdCalc.toFixed(2)}</span>
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
