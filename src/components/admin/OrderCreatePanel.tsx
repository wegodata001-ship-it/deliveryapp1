"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrderStatus, PaymentMethod } from "@prisma/client";
import {
  CalendarDays,
  DollarSign,
  FileText,
  Globe2,
  Hash,
  Lock,
  Percent,
  Phone,
  Plus,
  Save,
  Search,
  User,
} from "lucide-react";
import {
  getOrderForWorkPanelAction,
  listCustomersForOrderQuickPickAction,
  type CaptureState,
  type ClientCreateResult,
  type CustomerSearchRow,
  type OrderWorkPanelPayload,
} from "@/app/admin/capture/actions";
import type { CustomerExtrasPayload } from "@/app/api/customers/extras/route";
import { createOrderEditRequestAction } from "@/app/admin/order-edit-requests/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import Card from "@/components/ui/Card";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { CustomerBalanceView } from "@/components/ui/CustomerBalanceView";
import { parseBalanceAmountString } from "@/lib/customer-balance";
import { formatMoneyAmount, parseMoneyString } from "@/lib/money-format";
import type { OrderCaptureWindowProps } from "@/lib/admin-windows";

async function fetchIntakeLocationsApi(query: string): Promise<{ id: string; label: string }[]> {
  const sp = new URLSearchParams();
  const q = query.trim();
  if (q) sp.set("q", q);
  sp.set("limit", q ? "120" : "500");
  const res = await fetch(`/api/intake-locations?${sp.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("intake-locations");
  const rows = (await res.json()) as { id: string; name: string }[];
  return rows.map((r) => ({ id: r.id, label: r.name }));
}
import { ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS } from "@/lib/order-capture-payment-methods";
import { orderCountryLabel, ORDER_COUNTRY_CODES, coerceOrderCountryForForm, type OrderCountryCode } from "@/lib/order-countries";
import type { SerializedFinancial } from "@/lib/financial-settings";
import { VAT_RATE, VAT_RATE_PERCENT, formatVatPercentLabel } from "@/lib/vat";
import { primaryCustomerDisplayName } from "@/lib/customer-names";
import {
  DEFAULT_WEEK_CODE,
  formatLocalHm,
  formatYmdJerusalem,
  getAhWeekRange,
} from "@/lib/work-week";
import { isValidYmd } from "@/lib/weeks/ah-week";
import {
  defaultDateInWeekRange,
  deriveAhWeekCodeFromOrderDateYmd,
  formatYmdSlash,
} from "@/lib/weeks/order-week-dates";
import { goToNextWeekNumber, goToPrevWeekNumber } from "@/lib/weeks/ah-week-nav";
import { AhWeekNavNextButton, AhWeekNavPrevButton } from "@/components/admin/AhWeekNavButtons";
import {
  ORDER_STATUS_EDIT_SELECT_OPTIONS,
  ORDER_STATUS_QUICK_SELECT_OPTIONS,
} from "@/constants/order-status";

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

type ComboField = "code" | "nameAr" | "nameEn";

function parseNum(s: string): number {
  const n = parseMoneyString(s);
  return n === null ? NaN : n;
}

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

async function loadCustomerExtrasFast(customerId: string): Promise<CustomerExtrasPayload | null> {
  const res = await fetch(`/api/customers/extras?id=${encodeURIComponent(customerId)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("טעינת פרטי לקוח נכשלה");
  return (await res.json()) as CustomerExtrasPayload | null;
}

async function loadCustomerBalanceFast(
  customerId: string,
): Promise<{ balanceUsdDisplay: string; balanceUsdNegative: boolean } | null> {
  const res = await fetch(`/api/customers/balance?id=${encodeURIComponent(customerId)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return (await res.json()) as { balanceUsdDisplay: string; balanceUsdNegative: boolean } | null;
}

function extrasFromCustomerRow(row: CustomerSearchRow): CustomerExtrasPayload | null {
  if (row.nameAr === undefined || row.nameEn === undefined) return null;
  const phone = row.phone ?? row.secondPhone ?? null;
  const indexLabel = row.oldCustomerCode?.trim() || row.code?.trim() || null;
  return {
    nameEn: row.nameEn ?? row.nameHe ?? null,
    nameAr: row.nameAr ?? null,
    phone,
    indexLabel,
    city: row.city?.trim() || null,
    address: row.address?.trim() || null,
    balanceUsdDisplay: "0.00",
    balanceUsdNegative: false,
  };
}

async function searchCustomersFast(query: string): Promise<CustomerSearchRow[]> {
  const res = await fetch(`/api/customers/search-fast?q=${encodeURIComponent(query)}`, { credentials: "include" });
  if (!res.ok) throw new Error("טעינת נתונים נכשלה");
  return (await res.json()) as CustomerSearchRow[];
}

async function resolveCustomerFast(query: string): Promise<CustomerSearchRow | null> {
  const res = await fetch(`/api/customers/search-fast?q=${encodeURIComponent(query)}&exact=1`, { credentials: "include" });
  if (!res.ok) throw new Error("טעינת נתונים נכשלה");
  return (await res.json()) as CustomerSearchRow | null;
}

type OrderBootPayload = { countries: string[]; orderNumberPreview: string | null };

async function fetchOrderBoot(weekCode: string): Promise<OrderBootPayload | null> {
  const res = await fetch(`/api/orders/boot?weekCode=${encodeURIComponent(weekCode)}`, {
    credentials: "include",
  });
  if (!res.ok) return null;
  return (await res.json()) as OrderBootPayload;
}

async function saveCaptureFast(payload: Record<string, unknown>): Promise<CaptureState> {
  const res = await fetch("/api/orders/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as CaptureState | null;
  return data ?? { ok: false, error: "שגיאה בשמירה" };
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
  const { openWindow, openCreateCustomerForOrder } = useAdminWindows();
  const { runWithLoading } = useAdminLoading();
  const { globalWeek, globalCountry } = useAdminGlobal();
  const idp = (s: string) => `${windowId}-${s}`;

  const isEdit = target.mode === "edit";

  const initialHm = useMemo(() => formatLocalHm(new Date()), []);

  const initialWeekCode = globalWeek || DEFAULT_WEEK_CODE;
  const initialWeekRange = useMemo(() => getAhWeekRange(initialWeekCode), [initialWeekCode]);

  const [orderExecutionDateYmd, setOrderExecutionDateYmd] = useState(() => {
    const today = formatYmdJerusalem();
    if (initialWeekRange) return defaultDateInWeekRange(initialWeekRange.from, initialWeekRange.to, today);
    return today;
  });
  const [intakeDateYmd, setIntakeDateYmd] = useState(() => formatYmdJerusalem());
  const [intakeTimeHm, setIntakeTimeHm] = useState(initialHm);
  const [executionDateErr, setExecutionDateErr] = useState<string | null>(null);
  const [intakeDateErr, setIntakeDateErr] = useState<string | null>(null);
  const [weekDraft, setWeekDraft] = useState(globalWeek || DEFAULT_WEEK_CODE);
  const [weekInputErr, setWeekInputErr] = useState<string | null>(null);
  const [feeUsdStr, setFeeUsdStr] = useState("");
  const [loadOrderBusy, setLoadOrderBusy] = useState(false);
  const [loadedSourceCountry, setLoadedSourceCountry] = useState<OrderCountryCode | "">("");
  const [editGate, setEditGate] = useState<OrderWorkPanelPayload["editGate"] | null>(null);
  const [editRequestOpen, setEditRequestOpen] = useState(false);
  const [editRequestReason, setEditRequestReason] = useState("");
  const [editRequestBusy, setEditRequestBusy] = useState(false);
  const [editRequestFlash, setEditRequestFlash] = useState<string | null>(null);

  const displayWeekCode = useMemo(
    () => deriveAhWeekCodeFromOrderDateYmd(orderExecutionDateYmd) ?? DEFAULT_WEEK_CODE,
    [orderExecutionDateYmd],
  );
  const weekRange = useMemo(() => getAhWeekRange(displayWeekCode), [displayWeekCode]);
  const weekRangeLabel = weekRange ? `${formatYmdSlash(weekRange.from)} – ${formatYmdSlash(weekRange.to)}` : "—";
  const currentWeekNumber = useMemo(
    () => parseWeekNumber(displayWeekCode) ?? parseWeekNumber(DEFAULT_WEEK_CODE) ?? 122,
    [displayWeekCode],
  );

  const weekOptions = useMemo(() => {
    const out: string[] = [];
    for (let n = 110; n <= 140; n++) out.push(toWeekCode(n));
    return out;
  }, []);

  const syncOrderDateToWeek = useCallback((code: string) => {
    const range = getAhWeekRange(code);
    if (!range) return;
    const def = defaultDateInWeekRange(range.from, range.to, formatYmdJerusalem());
    setOrderExecutionDateYmd(def);
    setExecutionDateErr(null);
  }, []);

  const applyWeekNumber = useCallback(
    (num: number) => {
      const nextCode = toWeekCode(num);
      setWeekDraft(nextCode);
      syncOrderDateToWeek(nextCode);
      setWeekInputErr(null);
    },
    [syncOrderDateToWeek],
  );

  const onExecutionDateChange = useCallback((ymd: string) => {
    setOrderExecutionDateYmd(ymd);
    setExecutionDateErr(ymd && !isValidYmd(ymd) ? "תאריך הזמנה לא תקין" : null);
  }, []);

  const onIntakeDateChange = useCallback((ymd: string) => {
    setIntakeDateYmd(ymd);
    setIntakeDateErr(ymd && !isValidYmd(ymd) ? "תאריך הזנה לא תקין" : null);
  }, []);

  useEffect(() => {
    setWeekDraft(displayWeekCode);
  }, [displayWeekCode]);

  const finalRate = useMemo(() => {
    const f = financial?.finalDollarRate ? Number(String(financial.finalDollarRate).replace(",", ".")) : NaN;
    return Number.isFinite(f) && f > 0 ? f : 3.5;
  }, [financial]);

  const commissionPct = useMemo(() => commissionPercentFromFinancial(financial), [financial]);

  const [orderNumberPreview, setOrderNumberPreview] = useState("…");

  /** שלושת שדות החיפוש + שורה ראשית — קוד משותף */
  const [codeStr, setCodeStr] = useState("");
  const [nameArStr, setNameArStr] = useState("");
  const [nameEnStr, setNameEnStr] = useState("");

  const [hits, setHits] = useState<CustomerSearchRow[]>([]);
  const [dropdownField, setDropdownField] = useState<ComboField | null>(null);
  const focusedComboRef = useRef<ComboField>("code");
  const skipSearchRef = useRef(false);
  const searchGenRef = useRef(0);
  const customerExtrasReqRef = useRef(0);

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchRow | null>(null);
  const [extras, setExtras] = useState<CustomerExtrasPayload | null>(null);

  const [phoneStr, setPhoneStr] = useState("");
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(OrderStatus.OPEN);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [isSearching, setIsSearching] = useState(false);

  const customerCodeInputRef = useRef<HTMLInputElement | null>(null);
  const usdInputRef = useRef<HTMLInputElement | null>(null);
  const paymentMethodRef = useRef<HTMLSelectElement | null>(null);
  const [paymentPointId, setPaymentPointId] = useState("");
  const [paymentPoints, setPaymentPoints] = useState<{ id: string; label: string }[]>([]);
  const [paymentPointQuery, setPaymentPointQuery] = useState("");
  const [paymentPointHits, setPaymentPointHits] = useState<{ id: string; label: string }[]>([]);
  const [paymentPointOpen, setPaymentPointOpen] = useState(false);
  const [paymentPointBusy, setPaymentPointBusy] = useState(false);
  const [paymentPointErr, setPaymentPointErr] = useState<string | null>(null);
  const paymentPointSearchGenRef = useRef(0);
  const [intakeActiveIdx, setIntakeActiveIdx] = useState(0);
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
    let cancelled = false;
    void fetchIntakeLocationsApi("")
      .then((rows) => {
        if (cancelled) return;
        setPaymentPoints(rows);
        setPaymentPointHits(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setPaymentPointErr("טעינת מקומות קליטה נכשלה");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const countrySelectOptions = useMemo(() => [...ORDER_COUNTRY_CODES] as OrderCountryCode[], []);

  useEffect(() => {
    if (orderCountries.length === 0) return;
    if (isEdit) return;
    setSourceCountry((cur) =>
      cur && orderCountries.includes(cur) ? cur : orderCountries[0] ?? (ORDER_COUNTRY_CODES[0] as OrderCountryCode),
    );
  }, [orderCountries, isEdit]);

  const refreshOrderNumberPreview = useCallback(async () => {
    if (isEdit) return;
    try {
      const boot = await fetchOrderBoot(displayWeekCode);
      setOrderNumberPreview(boot?.orderNumberPreview || "—");
    } catch (error) {
      console.error("order number preview failed", error);
      setOrderNumberPreview("—");
    }
  }, [isEdit, displayWeekCode]);

  // Single bootstrap request: countries + order-number preview in one round-trip
  // (replaces two server actions that each hit POST /admin and re-rendered the page).
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    void fetchOrderBoot(displayWeekCode).then((boot) => {
      if (cancelled || !boot) return;
      if (Array.isArray(boot.countries) && boot.countries.length > 0) {
        setOrderCountries(boot.countries as OrderCountryCode[]);
      }
      if (boot.orderNumberPreview) {
        setOrderNumberPreview(boot.orderNumberPreview);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isEdit, displayWeekCode]);

  // Edit mode: still need countries (no order-number preview).
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    void fetchOrderBoot("").then((boot) => {
      if (cancelled || !boot) return;
      if (Array.isArray(boot.countries) && boot.countries.length > 0) {
        setOrderCountries(boot.countries as OrderCountryCode[]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isEdit]);

  useEffect(() => {
    if (target.mode !== "create") return;
    setOrderNumberPreview("…");
    // boot effect above will refresh it
  }, [target.mode]);

  useEffect(() => {
    if (target.mode !== "create") return;
    if (orderNumberPreview !== "—") return;
    const t = window.setTimeout(() => {
      void refreshOrderNumberPreview();
    }, 350);
    return () => window.clearTimeout(t);
  }, [target.mode, orderNumberPreview, refreshOrderNumberPreview]);

  useEffect(() => {
    if (!isEdit) setLoadedSourceCountry("");
  }, [isEdit]);

  useEffect(() => {
    if (!isEdit) {
      setEditGate(null);
      setEditRequestFlash(null);
    }
  }, [isEdit]);

  const editOrderId = isEdit ? target.orderId : "";

  useEffect(() => {
    if (!isEdit || !editOrderId) return;
    let cancelled = false;
    setLoadOrderBusy(true);
    setErr(null);
    setEditGate(null);
    void getOrderForWorkPanelAction(editOrderId).then((row) => {
      if (cancelled) return;
      setLoadOrderBusy(false);
      if (!row) {
        setErr("לא ניתן לטעון את ההזמנה");
        return;
      }
      setEditGate(row.editGate);
      skipSearchRef.current = true;
      setOrderExecutionDateYmd(row.orderExecutionDateYmd);
      setIntakeDateYmd(row.intakeDateYmd);
      setIntakeTimeHm(row.intakeTimeHm);
      setExecutionDateErr(null);
      setIntakeDateErr(null);
      setWeekDraft(
        deriveAhWeekCodeFromOrderDateYmd(row.orderExecutionDateYmd) ??
          (row.weekCode.trim() || DEFAULT_WEEK_CODE),
      );
      setOrderNumberPreview(row.orderNumber);
      setOrderStatus(row.status);
      setPaymentMethod(row.paymentMethod);
      setPaymentPointId(row.locationId ?? row.paymentPointId ?? "");
      setPaymentPointQuery(row.locationName ?? "");
      setPaymentPointOpen(false);
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
    if (!paymentPointId) return;
    const match = paymentPoints.find((p) => p.id === paymentPointId);
    if (!match) return;
    setPaymentPointQuery(match.label);
  }, [paymentPointId, paymentPoints]);

  useEffect(() => {
    const q = paymentPointQuery;
    const gen = ++paymentPointSearchGenRef.current;
    const delay = q.trim() ? 200 : 0;
    const t = window.setTimeout(() => {
      setPaymentPointBusy(true);
      void fetchIntakeLocationsApi(q)
        .then((rows) => {
          if (paymentPointSearchGenRef.current !== gen) return;
          setPaymentPointBusy(false);
          setPaymentPointHits(rows);
        })
        .catch(() => {
          if (paymentPointSearchGenRef.current !== gen) return;
          setPaymentPointBusy(false);
          setPaymentPointHits([]);
        });
    }, delay);
    return () => window.clearTimeout(t);
  }, [paymentPointQuery]);

  useEffect(() => {
    if (paymentPointHits.length === 0) return;
    setPaymentPoints((cur) => {
      const map = new Map(cur.map((p) => [p.id, p]));
      for (const h of paymentPointHits) map.set(h.id, h);
      return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "he"));
    });
  }, [paymentPointHits]);

  useEffect(() => {
    setIntakeActiveIdx(0);
  }, [paymentPointHits]);

  const applyExtras = useCallback((ex: CustomerExtrasPayload) => {
    skipSearchRef.current = true;
    setExtras(ex);
    setNameArStr(ex.nameAr ?? "");
    setNameEnStr(ex.nameEn ?? "");
    setPhoneStr(ex.phone ?? "");
    queueMicrotask(() => {
      skipSearchRef.current = false;
    });
  }, []);

  const loadCustomerExtras = useCallback(
    async (customerId: string, prefillFromRow: CustomerExtrasPayload | null) => {
      const req = ++customerExtrasReqRef.current;
      try {
        // Path A — already have the cheap text fields (from search-fast row): apply them
        // synchronously and only fetch the balance (slow aggregate) in the background.
        if (prefillFromRow) {
          applyExtras(prefillFromRow);
          const bal = await loadCustomerBalanceFast(customerId);
          if (customerExtrasReqRef.current !== req) return;
          if (bal) {
            setExtras((cur) => (cur ? { ...cur, ...bal } : cur));
          }
          return;
        }
        // Path B — fallback (e.g. edit-mode where we only have id/label/code).
        const ex = await loadCustomerExtrasFast(customerId);
        if (customerExtrasReqRef.current !== req) return;
        if (!ex) {
          setExtras(null);
          setPhoneStr("");
          return;
        }
        applyExtras(ex);
      } catch (error) {
        if (customerExtrasReqRef.current !== req) return;
        setExtras(null);
        setPhoneStr("");
        setErr("טעינת נתונים נכשלה");
      }
    },
    [applyExtras],
  );

  useEffect(() => {
    if (!selectedCustomer) {
      setExtras(null);
      setPhoneStr("");
      return;
    }
    const prefill = extrasFromCustomerRow(selectedCustomer);
    void loadCustomerExtras(selectedCustomer.id, prefill);
  }, [selectedCustomer, loadCustomerExtras]);

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

  const vatAmountIls = useMemo(() => roundMoney2(totalBeforeVatIls * VAT_RATE), [totalBeforeVatIls]);

  const finalTotalIls = useMemo(() => roundMoney2(totalBeforeVatIls + vatAmountIls), [totalBeforeVatIls, vatAmountIls]);

  const vatAmountUsd = useMemo(() => (safeRate > 0 ? roundMoney2(vatAmountIls / safeRate) : 0), [vatAmountIls, safeRate]);

  const totalUsdCalc = useMemo(() => {
    if (!Number.isFinite(dealUsdTotal) || dealUsdTotal <= 0) return 0;
    return roundMoney2(dealUsdTotal + commissionUsdEffective);
  }, [dealUsdTotal, commissionUsdEffective]);

  const pickCustomer = useCallback((row: CustomerSearchRow) => {
    skipSearchRef.current = true;
    setErr(null);
    setSelectedCustomer(row);
    setCodeStr(row.code?.trim() ? row.code.trim() : row.id);
    if (row.nameAr != null) setNameArStr(row.nameAr);
    if (row.nameEn != null) setNameEnStr(row.nameEn);
    setHits([]);
    setDropdownField(null);
    setIsSearching(false);
    window.setTimeout(() => {
      skipSearchRef.current = false;
      const el = usdInputRef.current;
      if (el) {
        el.focus();
        try {
          el.select();
        } catch {
          /* noop */
        }
      }
    }, 0);
  }, []);

  const applyCreatedCustomer = useCallback(
    (client: ClientCreateResult) => {
      const row: CustomerSearchRow = {
        id: client.customerId,
        label: client.customerNameAr,
        code: client.customerCode,
        customerType: null,
        city: null,
        phone: client.phone,
        nameAr: client.customerNameAr,
        nameEn: client.customerNameEn,
      };
      skipSearchRef.current = true;
      setErr(null);
      setSelectedCustomer(row);
      setCodeStr(client.customerCode);
      setNameArStr(client.customerNameAr);
      setNameEnStr(client.customerNameEn ?? "");
      setPhoneStr(client.phone);
      setHits([]);
      setDropdownField(null);
      applyExtras({
        nameAr: client.customerNameAr,
        nameEn: client.customerNameEn,
        phone: client.phone,
        indexLabel: client.customerCode,
        city: null,
        address: null,
        balanceUsdDisplay: "0.00",
        balanceUsdNegative: false,
      });
      void loadCustomerBalanceFast(client.customerId).then((bal) => {
        if (bal) setExtras((cur) => (cur ? { ...cur, ...bal } : cur));
      });
      queueMicrotask(() => {
        skipSearchRef.current = false;
      });
      onToast(`לקוח ${client.customerNameAr} נוסף ונבחר`);
      window.setTimeout(() => usdInputRef.current?.focus(), 0);
    },
    [applyExtras, onToast],
  );

  const openNewCustomerModal = useCallback(() => {
    if (!canCreateOrders) return;
    openCreateCustomerForOrder(applyCreatedCustomer);
  }, [canCreateOrders, openCreateCustomerForOrder, applyCreatedCustomer]);

  /** חיפוש כשמשנים קלט באחד משלושת השדות — לפי השדה במיקוד */
  useEffect(() => {
    if (skipSearchRef.current) return;
    const field = focusedComboRef.current;
    const q = field === "code" ? codeStr : field === "nameAr" ? nameArStr : nameEnStr;
    const trimmed = q.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
    if (!trimmed || (!isUuid && trimmed.length < 2)) {
      setHits([]);
      setIsSearching(false);
      return;
    }
    const gen = ++searchGenRef.current;
    setIsSearching(true);
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const rows = await searchCustomersFast(trimmed);
          if (searchGenRef.current !== gen) return;
          setHits(rows);
          setDropdownField(field);
        } catch {
          if (searchGenRef.current !== gen) return;
          setErr("טעינת נתונים נכשלה");
          setHits([]);
        } finally {
          if (searchGenRef.current === gen) setIsSearching(false);
        }
      })();
    }, 120);
    return () => window.clearTimeout(t);
  }, [codeStr, nameArStr, nameEnStr]);

  const openFullList = useCallback(async (field: ComboField) => {
    focusedComboRef.current = field;
    const rows = await listCustomersForOrderQuickPickAction();
    setHits(rows);
    setDropdownField(field);
  }, []);

  const resolveExactCode = useCallback(async () => {
    setErr(null);
    const raw = codeStr.trim();
    if (!raw) {
      setErr("הזינו קוד לקוח");
      return;
    }
    setIsSearching(true);
    try {
      const row = await resolveCustomerFast(raw);
      if (row) {
        pickCustomer(row);
        return;
      }
      const found = await searchCustomersFast(raw);
      const exact =
        found.find((h) => (h.code || "").trim().toLowerCase() === raw.toLowerCase()) ??
        found.find((h) => h.label.trim().toLowerCase() === raw.toLowerCase());
      if (exact) pickCustomer(exact);
      else setErr("לקוח לא נמצא");
    } finally {
      setIsSearching(false);
    }
  }, [codeStr, pickCustomer]);

  const resetFormForNew = useCallback(() => {
    skipSearchRef.current = true;
    setSelectedCustomer(null);
    setExtras(null);
    setCodeStr("");
    setNameArStr("");
    setNameEnStr("");
    setPhoneStr("");
    setNotes("");
    setDealUsdStr("");
    setDealIlsStr("");
    setFeeUsdStr("");
    setHits([]);
    setDropdownField(null);
    setIsSearching(false);
    setErr(null);
    setPaymentMethod(PaymentMethod.CASH);
    setOrderStatus(OrderStatus.OPEN);
    {
      const code = globalWeek || DEFAULT_WEEK_CODE;
      const range = getAhWeekRange(code);
      if (range) {
        const def = defaultDateInWeekRange(range.from, range.to, formatYmdJerusalem());
        setOrderExecutionDateYmd(def);
      }
      setIntakeDateYmd(formatYmdJerusalem());
      setIntakeTimeHm(formatLocalHm(new Date()));
      setExecutionDateErr(null);
      setIntakeDateErr(null);
    }
    window.setTimeout(() => {
      skipSearchRef.current = false;
      const el = customerCodeInputRef.current;
      if (el) {
        el.focus();
        try {
          el.select();
        } catch {
          /* noop */
        }
      }
    }, 0);
  }, []);

  // Latest state ref — read at save time only. Lets performSave stay stable
  // across renders so the global keydown listener (Ctrl+Enter / Ctrl+N) doesn't
  // unbind/rebind on every keystroke in money/notes/customer fields.
  const performSaveStateRef = useRef({
    isSaving,
    isEdit,
    editGate,
    selectedCustomer,
    codeStr,
    dealUsdTotal,
    sourceCountry,
    loadedSourceCountry,
    canEditOrders,
    canCreateOrders,
    editOrderId,
    paymentPointId,
    paymentPointQuery,
    commissionUsdEffective,
    commissionUsdCalc,
    orderExecutionDateYmd,
    intakeDateYmd,
    intakeTimeHm,
    paymentMethod,
    orderStatus,
    notes,
    nameArStr,
    nameEnStr,
  });
  performSaveStateRef.current = {
    isSaving,
    isEdit,
    editGate,
    selectedCustomer,
    codeStr,
    dealUsdTotal,
    sourceCountry,
    loadedSourceCountry,
    canEditOrders,
    canCreateOrders,
    editOrderId,
    paymentPointId,
    paymentPointQuery,
    commissionUsdEffective,
    commissionUsdCalc,
    orderExecutionDateYmd,
    intakeDateYmd,
    intakeTimeHm,
    paymentMethod,
    orderStatus,
    notes,
    nameArStr,
    nameEnStr,
  };

  const performSave = useCallback(
    async (keepOpen: boolean) => {
      const s = performSaveStateRef.current;
      if (s.isSaving) return;
      if (s.isEdit && s.editGate?.employeeEditBlocked) return;

      let cust = s.selectedCustomer;
      if (!cust && s.codeStr.trim()) {
        const row = await resolveCustomerFast(s.codeStr.trim());
        if (row) {
          pickCustomer(row);
          cust = row;
        }
      }
      if (!cust) {
        setErr("יש לבחור לקוח באחד משדות החיפוש");
        return;
      }

      if (!Number.isFinite(s.dealUsdTotal) || s.dealUsdTotal <= 0) {
        setErr("יש להזין סכום עסקה (₪ או $)");
        return;
      }
      const countryForSave =
        coerceOrderCountryForForm(s.sourceCountry) ||
        (s.isEdit ? coerceOrderCountryForForm(s.loadedSourceCountry) : "");
      if (!countryForSave) {
        setErr("יש לבחור מדינת מקור");
        return;
      }

      if (s.isEdit && (!s.canEditOrders || !s.editOrderId)) {
        setErr("אין הרשאה לעריכה");
        return;
      }
      if (!s.isEdit && !s.canCreateOrders) {
        setErr("אין הרשאה ליצירת הזמנה");
        return;
      }

      const intakeDraft =
        !s.paymentPointId.trim() && s.paymentPointQuery.trim() ? s.paymentPointQuery.trim() : "";
      if (intakeDraft && intakeDraft.length < 2) {
        setErr("מקום קליטה: יש לבחור מהרשימה או להזין לפחות שני תווים");
        return;
      }

      if (!s.orderExecutionDateYmd.trim() || !isValidYmd(s.orderExecutionDateYmd)) {
        setExecutionDateErr("יש להזין תאריך הזמנה תקין");
        setErr("יש להזין תאריך הזמנה תקין");
        return;
      }
      if (!s.intakeDateYmd.trim() || !isValidYmd(s.intakeDateYmd)) {
        setIntakeDateErr("יש להזין תאריך הזנה תקין");
        setErr("יש להזין תאריך הזנה תקין");
        return;
      }

      try {
        setIsSaving(true);
        setErr(null);

        if (s.isEdit) {
          const feeStr = s.commissionUsdEffective.toFixed(2);
          const res = await runWithLoading(
            () =>
              saveCaptureFast({
                mode: "update",
                orderId: s.editOrderId,
                orderExecutionDateYmd: s.orderExecutionDateYmd,
                intakeDateYmd: s.intakeDateYmd,
                intakeTimeHm: s.intakeTimeHm,
                customerId: cust.id,
                amountUsd: roundMoney2(s.dealUsdTotal).toFixed(2),
                feeUsd: feeStr,
                paymentMethod: s.paymentMethod,
                status: s.orderStatus,
                notes: s.notes.trim() || undefined,
                paymentPointId: s.paymentPointId.trim() || null,
                locationId: s.paymentPointId.trim() || null,
                intakeLocationDraftName:
                  !s.paymentPointId.trim() && s.paymentPointQuery.trim() ? s.paymentPointQuery.trim() : undefined,
                paymentLines: undefined,
                sourceCountry: countryForSave,
                draftNameAr: s.nameArStr.trim() || null,
                draftNameEn: s.nameEnStr.trim() || null,
              }),
            { message: "שומר נתונים...", mode: "bar" },
          );
          if (!res.ok) throw new Error(res.error);
          onToast("ההזמנה עודכנה בהצלחה!");
        } else {
          const feeStr = s.commissionUsdCalc.toFixed(2);
          const res = await runWithLoading(
            () =>
              saveCaptureFast({
                mode: "create",
                orderExecutionDateYmd: s.orderExecutionDateYmd,
                intakeDateYmd: s.intakeDateYmd,
                intakeTimeHm: s.intakeTimeHm,
                customerId: cust.id,
                amountUsd: roundMoney2(s.dealUsdTotal).toFixed(2),
                feeUsd: feeStr,
                paymentMethod: s.paymentMethod,
                status: s.orderStatus,
                notes: s.notes.trim() || undefined,
                paymentPointId: s.paymentPointId.trim() || null,
                locationId: s.paymentPointId.trim() || null,
                intakeLocationDraftName:
                  !s.paymentPointId.trim() && s.paymentPointQuery.trim() ? s.paymentPointQuery.trim() : undefined,
                vatPercent: String(VAT_RATE_PERCENT),
                paymentLines: undefined,
                sourceCountry: countryForSave,
                draftNameAr: s.nameArStr.trim() || null,
                draftNameEn: s.nameEnStr.trim() || null,
              }),
            { message: "שומר נתונים...", mode: "bar" },
          );
          if (!res.ok) throw new Error(res.error);
          onToast("הזמנה נוצרה בהצלחה!");
        }

        onSaved?.();
        if (keepOpen && !s.isEdit) {
          resetFormForNew();
          void refreshOrderNumberPreview();
        } else {
          onClose();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "שגיאה בשמירה";
        setErr(msg);
        onToast("שגיאה בשמירה");
      } finally {
        setIsSaving(false);
      }
    },
    [pickCustomer, runWithLoading, onToast, onSaved, onClose, resetFormForNew, refreshOrderNumberPreview],
  );

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void performSave(false);
    },
    [performSave],
  );

  /** Initial focus on customer code input (create mode) + keyboard shortcuts */
  useEffect(() => {
    if (target.mode !== "create") return;
    const t = window.setTimeout(() => {
      customerCodeInputRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(t);
  }, [target.mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSaving) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void performSave(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
        if (isEdit) return;
        e.preventDefault();
        void performSave(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [performSave, isSaving, isEdit]);

  const customerMiniLine = useMemo(() => {
    if (!selectedCustomer || !extras) return "";
    const name = primaryCustomerDisplayName({
      nameAr: nameArStr.trim() || null,
      nameEn: nameEnStr.trim() || null,
      displayName: selectedCustomer.label,
    });
    const phone = (phoneStr || extras.phone || "").trim();
    const place = [extras.city, extras.address].filter(Boolean).join(" · ");
    const parts = [`👤 ${name}`, phone, place].filter((p) => p.length > 0);
    return parts.join(" | ");
  }, [selectedCustomer, extras, nameEnStr, nameArStr, phoneStr]);

  function blurCloseDropdown() {
    window.setTimeout(() => setDropdownField(null), 180);
  }

  const closeCustomerDropdown = useCallback(() => {
    setDropdownField(null);
    setHits([]);
  }, []);

  const normalizeLookupKey = useCallback((value: string) => value.trim().toLowerCase().replace(/\s+/g, ""), []);

  const selectPaymentPoint = useCallback((row: { id: string; label: string }) => {
    setPaymentPointId(row.id);
    setPaymentPointQuery(row.label);
    setPaymentPointOpen(false);
    setPaymentPointErr(null);
  }, []);

  const commitPendingIntakeName = useCallback(() => {
    const name = paymentPointQuery.trim();
    if (name.length < 2) return;
    setPaymentPointId("");
    setPaymentPointOpen(false);
    setPaymentPointErr(null);
  }, [paymentPointQuery]);

  const handleIntakeLocationKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        if (paymentPointOpen) {
          e.preventDefault();
          setPaymentPointOpen(false);
        }
        return;
      }
      if (e.key === "ArrowDown" && paymentPointOpen && paymentPointHits.length > 0) {
        e.preventDefault();
        setIntakeActiveIdx((i) => Math.min(i + 1, paymentPointHits.length - 1));
        return;
      }
      if (e.key === "ArrowUp" && paymentPointOpen && paymentPointHits.length > 0) {
        e.preventDefault();
        setIntakeActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key !== "Enter") return;
      if (!paymentPointOpen) return;
      e.preventDefault();
      const q = paymentPointQuery.trim();
      if (paymentPointBusy) return;
      const exact = paymentPointHits.find((p) => normalizeLookupKey(p.label) === normalizeLookupKey(q));
      if (exact) {
        selectPaymentPoint(exact);
        return;
      }
      if (paymentPointHits.length > 0) {
        const idx = Math.min(Math.max(intakeActiveIdx, 0), paymentPointHits.length - 1);
        selectPaymentPoint(paymentPointHits[idx]);
        return;
      }
      if (q.length >= 2) {
        commitPendingIntakeName();
      }
    },
    [
      paymentPointOpen,
      paymentPointHits,
      paymentPointBusy,
      paymentPointQuery,
      normalizeLookupKey,
      selectPaymentPoint,
      intakeActiveIdx,
      commitPendingIntakeName,
    ],
  );

  if (target.mode === "create" && !canCreateOrders) return null;
  if (target.mode === "edit" && !canEditOrders) return null;

  if (isEdit && loadOrderBusy) {
    return (
      <div className="adm-order-create-legacy-wrap">
        <p className="adm-order-work-panel-loading">טוען…</p>
      </div>
    );
  }

  const formLocked = Boolean(isEdit && editGate?.employeeEditBlocked);
  const fieldDisabled = isSaving || formLocked;

  const statusOptions = isEdit ? ORDER_STATUS_EDIT_SELECT_OPTIONS : ORDER_STATUS_QUICK_SELECT_OPTIONS;

  return (
    <div className="adm-order-create-legacy-wrap adm-oc-pro-wrap">
      <form
        className="adm-order-create adm-order-create--legacy adm-capture-order-shell adm-oc-pro"
        onSubmit={onSubmit}
        dir="rtl"
      >
        <header className="adm-oc-pro-header" dir="rtl">
          <div className="adm-oc-pro-header__title">
            <span className="adm-oc-pro-header__icon" aria-hidden>
              <FileText size={18} strokeWidth={2.2} />
            </span>
            <h2>{isEdit ? "עריכת הזמנה" : "קליטת הזמנה"}</h2>
          </div>
        </header>

        <div
          className="order-top-toolbar"
          dir="ltr"
          aria-label={isEdit ? "תאריכי קליטה וביצוע" : "פעולות מהירות ותאריכי קליטה"}
        >
          {!isEdit ? (
            <div className="order-top-toolbar__actions">
              <button
                type="button"
                className="adm-oc-pro-new"
                disabled={isSaving || !canCreateOrders || formLocked}
                title="שמירה ופתיחת קליטה חדשה (Ctrl+N)"
                onClick={() => void performSave(true)}
              >
                <Plus size={15} strokeWidth={2.4} aria-hidden />
                <span>חדש</span>
              </button>
              {canCreateOrders ? (
                <button
                  type="button"
                  className="adm-oc-pro-new-customer"
                  disabled={fieldDisabled}
                  title="יצירת לקוח חדש ומילוי אוטומטי בטופס"
                  onClick={openNewCustomerModal}
                >
                  <Plus size={15} strokeWidth={2.4} aria-hidden />
                  <span>לקוח חדש</span>
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="order-top-toolbar__item">
            <label htmlFor={idp("exec-date")} className="order-top-toolbar__lbl">
              תאריך הזמנה
            </label>
            <input
              id={idp("exec-date")}
              type="date"
              className={executionDateErr ? "order-top-toolbar__inp is-err" : "order-top-toolbar__inp"}
              disabled={fieldDisabled}
              dir="ltr"
              value={orderExecutionDateYmd}
              title="תאריך עסקי — קובע שבוע AH, דוחות וסינונים"
              onChange={(e) => onExecutionDateChange(e.target.value)}
            />
          </div>
          <div className="order-top-toolbar__item">
            <label htmlFor={idp("intake-date")} className="order-top-toolbar__lbl">
              תאריך הזנה
            </label>
            <input
              id={idp("intake-date")}
              type="date"
              className={intakeDateErr ? "order-top-toolbar__inp is-err" : "order-top-toolbar__inp"}
              disabled={fieldDisabled}
              dir="ltr"
              value={intakeDateYmd}
              title="מתי ההזמנה נכנסה למערכת — לא משפיע על שבוע או דוחות"
              onChange={(e) => onIntakeDateChange(e.target.value)}
            />
          </div>
          <div className="order-top-toolbar__item">
            <label htmlFor={idp("intake-time")} className="order-top-toolbar__lbl">
              שעת הזנה
            </label>
            <input
              id={idp("intake-time")}
              type="time"
              className={
                intakeDateErr
                  ? "order-top-toolbar__inp order-top-toolbar__inp--time is-err"
                  : "order-top-toolbar__inp order-top-toolbar__inp--time"
              }
              disabled={fieldDisabled}
              dir="ltr"
              value={intakeTimeHm}
              onChange={(e) => setIntakeTimeHm(e.target.value)}
            />
          </div>
          <div
            className="order-top-toolbar__range"
            role="group"
            aria-label="טווח שבוע"
            title="שבוע AH מחושב מתאריך הזמנה"
          >
            <span className="order-top-toolbar__range-lbl">טווח שבוע</span>
            <span className="order-top-toolbar__range-dates" dir="ltr">
              {weekRangeLabel}
            </span>
            <span className="order-top-toolbar__range-sep" aria-hidden>
              ·
            </span>
            <span className="order-top-toolbar__range-code" dir="ltr">
              {displayWeekCode}
            </span>
          </div>
          {executionDateErr || intakeDateErr ? (
            <p className="order-top-toolbar__errs">
              {[executionDateErr, intakeDateErr].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>

        <div className="adm-oc-pro-scroll">
        {err ? <div className="adm-error adm-error--compact adm-oc-legacy-err">{err}</div> : null}

        {isEdit && formLocked ? (
          <div className="adm-oc-edit-lock-banner" role="status">
            <p>הזמנה זו נעולה לעריכה (מוכנה או מבוטלת). יש לשלוח בקשת אישור מנהל.</p>
            {editGate?.hasPendingEditRequest ? (
              <p style={{ marginTop: "0.35rem", fontWeight: 700 }}>
                {editGate.pendingEditRequestOwnedByMe
                  ? "הבקשה שלך ממתינה לאישור."
                  : "קיימת בקשת עריכה ממתינה להזמנה זו."}
              </p>
            ) : null}
            <div className="adm-oc-edit-lock-actions">
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--dense"
                disabled={editRequestBusy || !!editGate?.hasPendingEditRequest}
                onClick={() => {
                  setEditRequestFlash(null);
                  setEditRequestReason("");
                  setEditRequestOpen(true);
                }}
              >
                שלח בקשת עריכה
              </button>
            </div>
          </div>
        ) : null}

        {isEdit && editRequestFlash ? (
          <div className="adm-settings-toast adm-oc-edit-request-sent-flash" role="status">
            {editRequestFlash}
          </div>
        ) : null}

        {isEdit && editGate && !editGate.viewerIsAdmin && editGate.unlockExpiresAtIso && !formLocked ? (
          <div className="adm-oc-edit-unlock-hint" role="status">
            עריכה זמינה עד {new Date(editGate.unlockExpiresAtIso).toLocaleString("he-IL")}
          </div>
        ) : null}

        <div className="modal-container adm-oc-pro-grid">
          <div className="modal-main adm-oc-pro-main">
            <Card className="adm-oc-pro-card adm-oc-pro-card--general">
              <div className="adm-oc-pro-section adm-oc-pro-section--top">
                <h3 className="adm-oc-pro-section-title">
                  <FileText size={12} strokeWidth={2.4} aria-hidden />
                  <span>פרטי הזמנה</span>
                </h3>
        {/* שורת עליונה — קטנה, מימין */}
        <div className="adm-oc-legacy-topbar adm-oc-pro-topbar">
          <span className="adm-oc-legacy-topbar-item adm-oc-pro-item adm-oc-pro-week-cell">
            <label htmlFor={idp("week-inp")} className="adm-oc-legacy-micro-label adm-oc-pro-mlbl">
              <CalendarDays size={12} strokeWidth={2.2} aria-hidden /> שבוע
            </label>
            <div className="adm-oc-pro-week-line" dir="ltr">
            <div className="adm-oc-week-row adm-oc-pro-week" dir="ltr">
              <AhWeekNavPrevButton
                className="adm-oc-week-arrow"
                variant="angle"
                disabled={fieldDisabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  applyWeekNumber(goToPrevWeekNumber(currentWeekNumber));
                  setWeekInputErr(null);
                }}
              />
              <input
                id={idp("week-inp")}
                type="text"
                className={weekInputErr ? "adm-oc-legacy-top-inp adm-oc-week-inp--err" : "adm-oc-legacy-top-inp"}
                value={weekDraft}
                dir="ltr"
                list={idp("week-list")}
                disabled={fieldDisabled}
                title={weekInputErr || "משנה את תאריך ההזמנה — השבוע מחושב אוטומטית"}
                onChange={(e) => {
                  const up = e.target.value.trim().toUpperCase();
                  setWeekDraft(up);

                  const num = parseWeekNumber(up);
                  if (num == null) {
                    setWeekInputErr(up ? "שבוע לא תקין" : null);
                    return;
                  }
                  setWeekInputErr(null);
                  applyWeekNumber(num);
                }}
                onBlur={() => {
                  const num = parseWeekNumber(weekDraft.trim().toUpperCase());
                  if (num == null) {
                    setWeekInputErr(null);
                    setWeekDraft(displayWeekCode);
                    return;
                  }
                  setWeekDraft(toWeekCode(num));
                }}
              />
              <AhWeekNavNextButton
                className="adm-oc-week-arrow"
                variant="angle"
                disabled={fieldDisabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  applyWeekNumber(goToNextWeekNumber(currentWeekNumber));
                  setWeekInputErr(null);
                }}
              />
              <button
                type="button"
                className="adm-oc-week-dd"
                disabled={fieldDisabled}
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
            </div>
          </span>
          <span className="adm-oc-legacy-topbar-item adm-oc-pro-item">
            <label htmlFor={idp("ordnum-top")} className="adm-oc-legacy-micro-label adm-oc-pro-mlbl">
              <Hash size={12} strokeWidth={2.2} aria-hidden /> מספר הזמנה
            </label>
            <input
              id={idp("ordnum-top")}
              type="text"
              readOnly
              className="adm-oc-legacy-top-inp adm-oc-pro-inp--ro"
              value={orderNumberPreview}
              dir="ltr"
            />
          </span>
          <span className="adm-oc-legacy-topbar-item adm-oc-pro-item">
            <label htmlFor={idp("country")} className="adm-oc-legacy-micro-label adm-oc-pro-mlbl">
              <Globe2 size={12} strokeWidth={2.2} aria-hidden /> מדינה
            </label>
            <select
              id={idp("country")}
              className="adm-oc-legacy-top-sel"
              value={sourceCountry}
              disabled={fieldDisabled}
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
                <option key={c} value={c} disabled={!orderCountries.includes(c)}>
                  {orderCountryLabel(c)}
                </option>
              ))}
            </select>
          </span>
          <span className="adm-oc-legacy-topbar-item adm-oc-pro-item">
            <label className="adm-oc-legacy-micro-label adm-oc-pro-mlbl">
              <DollarSign size={12} strokeWidth={2.2} aria-hidden /> שער דולר
            </label>
            <input
              type="text"
              readOnly
              className="adm-oc-legacy-top-inp adm-oc-pro-inp--ro"
              value={finalRate.toFixed(2)}
              dir="ltr"
              title="שער דולר סופי מהגדרות"
            />
          </span>
          <span className="adm-oc-legacy-topbar-item adm-oc-pro-item">
            <label className="adm-oc-legacy-micro-label adm-oc-pro-mlbl">
              <Percent size={12} strokeWidth={2.2} aria-hidden /> עמלה %
            </label>
            <input
              type="text"
              readOnly
              className="adm-oc-legacy-top-inp adm-oc-pro-inp--ro"
              value={commissionPct.toFixed(2)}
              dir="ltr"
              title="אחוז עמלה מהגדרות כספים"
            />
          </span>
          <span className="adm-oc-legacy-topbar-item adm-oc-pro-item">
            <label htmlFor={idp("phone-top")} className="adm-oc-legacy-micro-label adm-oc-pro-mlbl">
              <Phone size={12} strokeWidth={2.2} aria-hidden /> טלפון
            </label>
            <input
              id={idp("phone-top")}
              type="text"
              readOnly
              className="adm-oc-legacy-top-inp adm-oc-pro-inp--ro"
              value={phoneStr}
              dir="ltr"
              placeholder="—"
              title="מתמלא אוטומטית לפי הלקוח"
            />
          </span>
        </div>
              </div>

              <div className="adm-oc-pro-section adm-oc-pro-section--customer">
                <h3 className="adm-oc-pro-section-title adm-oc-pro-section-title--customer">
                  <Search size={12} strokeWidth={2.4} aria-hidden />
                  <span>לקוח</span>
                </h3>
        {/* שורה ראשית — גדולה */}
        <div className="adm-oc-legacy-mainrow adm-oc-pro-mainrow">
          <div className={`adm-oc-legacy-main-field adm-oc-pro-field--code${dropdownField === "code" && hits.length > 0 ? " adm-oc-legacy-main-field--open" : ""}`}>
            <label htmlFor={idp("code-main")} className="adm-oc-pro-lbl adm-oc-pro-lbl--code">
              <Search size={12} strokeWidth={2.4} aria-hidden /> קוד לקוח
            </label>
            <div className="adm-oc-legacy-main-code-with-icon">
              <div className="adm-oc-legacy-main-code-wrap adm-oc-pro-code-wrap">
                <span className="adm-oc-pro-code-search" aria-hidden>
                  <Search size={14} strokeWidth={2.4} />
                </span>
                <input
                  id={idp("code-main")}
                  ref={customerCodeInputRef}
                  type="text"
                  autoComplete="off"
                  className="adm-oc-legacy-main-inp adm-oc-pro-code-inp"
                  disabled={fieldDisabled}
                  dir="ltr"
                  value={codeStr}
                  placeholder="קוד / שם / טלפון"
                  onChange={(e) => {
                    setCodeStr(e.target.value);
                    setSelectedCustomer(null);
                  }}
                  onFocus={() => {
                    focusedComboRef.current = "code";
                  }}
                  onBlur={() => {
                    blurCloseDropdown();
                    if (dropdownField === "code" && hits.length > 0) return;
                    void resolveExactCode();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void resolveExactCode();
                    }
                  }}
                />
                {isSearching ? <span className="adm-oc-inline-spinner" aria-hidden /> : null}
                <button
                  type="button"
                  className="adm-oc-legacy-main-arrow"
                  disabled={fieldDisabled}
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
                        <button
                          type="button"
                          className="adm-oc-legacy-dd-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickCustomer(row);
                          }}
                          onClick={() => pickCustomer(row)}
                        >
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
                disabled={fieldDisabled || !selectedCustomer}
                title="פתח כרטסת לקוח"
                aria-label="פתח כרטסת לקוח"
                onClick={openCustomerCard}
              >
                <User size={16} strokeWidth={2} aria-hidden />
              </button>
            </div>
          </div>
        </div>

            <div className="adm-oc-legacy-center adm-oc-pro-customer-center">
            {customerMiniLine ? (
              <div className="adm-oc-legacy-customer-mini" dir="rtl">
                <span className="adm-oc-legacy-customer-mini-text">{customerMiniLine}</span>
                {extras ? (
                  <span dir="ltr" className="adm-oc-legacy-customer-mini-bal">
                    <CustomerBalanceView
                      businessSigned={parseBalanceAmountString(extras.balanceUsdDisplay)}
                      currency="USD"
                    />
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
                    disabled={fieldDisabled}
                    dir="rtl"
                    className="adm-oc-legacy-combo-inp"
                    placeholder="הזן שם בערבית"
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
                    disabled={fieldDisabled}
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
                        <button
                          type="button"
                          className="adm-oc-legacy-dd-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickCustomer(row);
                          }}
                          onClick={() => pickCustomer(row)}
                        >
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

              {/* אנגלית */}
              <div className="adm-oc-legacy-field-wrap">
                <div className="adm-oc-legacy-label-with-action">
                  <label htmlFor={idp("c-en")}>שם באנגלית</label>
                  <button
                    type="button"
                    className="adm-oc-legacy-customer-card-btn adm-oc-legacy-customer-card-btn--inline"
                    disabled={fieldDisabled || !selectedCustomer}
                    title="פתח כרטסת לקוח"
                    aria-label="פתח כרטסת לקוח"
                    onClick={openCustomerCard}
                  >
                    <User size={16} strokeWidth={2} aria-hidden />
                  </button>
                </div>
                <div className="adm-oc-legacy-input-row">
                  <input
                    id={idp("c-en")}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={fieldDisabled}
                    dir="ltr"
                    className="adm-oc-legacy-combo-inp"
                    placeholder="Enter English name"
                    value={nameEnStr}
                    onChange={(e) => {
                      setNameEnStr(e.target.value);
                      setSelectedCustomer(null);
                    }}
                    onFocus={() => {
                      focusedComboRef.current = "nameEn";
                    }}
                    onBlur={blurCloseDropdown}
                  />
                  <button
                    type="button"
                    data-oc-arrow
                    className="adm-oc-legacy-arrow"
                    disabled={fieldDisabled}
                    aria-label="רשימה מלאה"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void openFullList("nameEn")}
                  >
                    ▼
                  </button>
                </div>
                {dropdownField === "nameEn" && hits.length > 0 ? (
                  <ul className="adm-oc-legacy-dd" role="listbox">
                    {hits.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className="adm-oc-legacy-dd-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickCustomer(row);
                          }}
                          onClick={() => pickCustomer(row)}
                        >
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

            </div>

            <div className="adm-oc-legacy-notes adm-oc-pro-notes-wrap">
              <label htmlFor={idp("notes")} className="adm-oc-pro-lbl">
                <FileText size={12} strokeWidth={2.2} aria-hidden /> הערות קצרות
              </label>
              <textarea
                id={idp("notes")}
                className="adm-oc-legacy-notes-ta adm-oc-pro-notes-ta"
                rows={1}
                disabled={fieldDisabled}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="הערות קצרות…"
              />
            </div>
          </div>

              </div>
            </Card>

            <Card className="adm-oc-pay-card adm-oc-pro-card adm-oc-pro-card--payment">
              <h3 className="adm-oc-pro-card-title adm-oc-pro-card-title--payment">פרטי תשלום</h3>
              <aside className="adm-oc-legacy-side adm-oc-pro-pay" aria-label="סטטוס ותשלום">
                <div className="adm-oc-legacy-side-field">
                  <label htmlFor={idp("ord-st")}>סטטוס הזמנה</label>
                  <select
                    id={idp("ord-st")}
                    className="adm-oc-legacy-side-sel"
                    disabled={fieldDisabled}
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
                  <label htmlFor={idp("pay-pt")}>מקום קליטת הזמנה</label>
                  <div
                    className="adm-oc-intake-combobox"
                    dir="rtl"
                    onBlur={() => window.setTimeout(() => setPaymentPointOpen(false), 160)}
                  >
                    <input
                      id={idp("pay-pt")}
                      type="text"
                      role="combobox"
                      aria-expanded={paymentPointOpen}
                      aria-controls={`${idp("pay-pt")}-listbox`}
                      aria-autocomplete="list"
                      className="adm-oc-legacy-side-sel adm-oc-intake-combobox-input"
                      disabled={fieldDisabled}
                      value={paymentPointQuery}
                      placeholder="בחרו או הקלידו מקום קליטה…"
                      autoComplete="off"
                      onFocus={() => {
                        closeCustomerDropdown();
                        setPaymentPointOpen(true);
                      }}
                      onKeyDown={handleIntakeLocationKeyDown}
                      onChange={(e) => {
                        setPaymentPointQuery(e.target.value);
                        setPaymentPointId("");
                        setPaymentPointOpen(true);
                        setPaymentPointErr(null);
                      }}
                    />
                    {paymentPointOpen ? (
                      <ul
                        id={`${idp("pay-pt")}-listbox`}
                        className="adm-oc-intake-dd"
                        role="listbox"
                        aria-label="מקומות קליטה"
                      >
                        {paymentPointBusy ? (
                          <li className="adm-oc-intake-dd-item adm-oc-intake-dd-item--static">טוען…</li>
                        ) : null}
                        {!paymentPointBusy && paymentPointHits.length === 0 && paymentPointQuery.trim().length >= 1 ? (
                          <li className="adm-oc-intake-dd-item adm-oc-intake-dd-item--static">
                            <button
                              type="button"
                              className="adm-oc-intake-dd-empty-action"
                              disabled={paymentPointQuery.trim().length < 2}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                if (paymentPointQuery.trim().length >= 2) commitPendingIntakeName();
                              }}
                            >
                              לא נמצא מקום. לחץ Enter כדי ליצור מקום חדש
                            </button>
                          </li>
                        ) : null}
                        {!paymentPointBusy && paymentPointHits.length === 0 && paymentPointQuery.trim().length === 0 ? (
                          <li className="adm-oc-intake-dd-item adm-oc-intake-dd-item--static adm-oc-intake-dd-muted">
                            אין עדיין מקומות — הקלידו שם ושמרו את ההזמנה
                          </li>
                        ) : null}
                        {!paymentPointBusy
                          ? paymentPointHits.map((row, i) => (
                              <li key={row.id} role="presentation">
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={intakeActiveIdx === i}
                                  className={`adm-oc-intake-dd-item${intakeActiveIdx === i ? " adm-oc-intake-dd-item--active" : ""}`}
                                  onMouseEnter={() => setIntakeActiveIdx(i)}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    selectPaymentPoint(row);
                                  }}
                                  onClick={() => selectPaymentPoint(row)}
                                >
                                  {row.label}
                                </button>
                              </li>
                            ))
                          : null}
                      </ul>
                    ) : null}
                  </div>
                  {paymentPointErr ? <div className="adm-oc-inline-err">{paymentPointErr}</div> : null}
                </div>
                <div className="adm-oc-legacy-side-field">
                  <label htmlFor={idp("pay-m")}>צורת תשלום</label>
                  <select
                    id={idp("pay-m")}
                    ref={paymentMethodRef}
                    className="adm-oc-legacy-side-sel"
                    disabled={fieldDisabled}
                    value={paymentMethod}
                    onFocus={closeCustomerDropdown}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void performSave(false);
                      }
                    }}
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

          <div className="modal-summary adm-oc-pro-money" dir="ltr">
            <Card className="summary-info adm-oc-legacy-card adm-oc-card--ils adm-oc-pro-card adm-oc-pro-card--ils">
              <div className="adm-oc-card-title adm-oc-pro-card-title adm-oc-pro-card-title--ils">₪ שקלים</div>
              <div className="adm-field adm-oc-field adm-oc-legacy-fin-field">
                <label htmlFor={idp("dils")}>סכום בשקלים</label>
                <MoneyInput
                  id={idp("dils")}
                  className="adm-oc-inp adm-oc-legacy-fin-inp"
                  disabled={fieldDisabled}
                  placeholder="הקלד סכום..."
                  value={(() => {
                    const n = parseNum(dealIlsStr);
                    return Number.isFinite(n) ? n : null;
                  })()}
                  onChange={(n) => setDealIlsStr(n == null ? "" : String(n))}
                />
              </div>
              <div className="adm-oc-xrate" dir="rtl" aria-live="polite">
                <span className="adm-oc-xrate-lbl">שווי בדולרים</span>
                <span className="adm-oc-xrate-val" dir="ltr">
                  ${formatMoneyAmount(roundMoney2(eqUsdFromIls))}
                </span>
              </div>
              <div className="adm-oc-line">
                <span>עמלה</span>
                <span dir="ltr">{formatMoneyAmount(commissionIlsEffective)} ₪</span>
              </div>
              <div className="adm-oc-line">
                <span>סה״כ לפני עמלה</span>
                <span dir="ltr">{formatMoneyAmount(roundMoney2(dealIlsTotal))} ₪</span>
              </div>
              <div className="adm-oc-line">
                <span>סה״כ לפני מע״מ</span>
                <span dir="ltr">{formatMoneyAmount(totalBeforeVatIls)} ₪</span>
              </div>
              <div className="adm-oc-line">
                <span>{formatVatPercentLabel()}</span>
                <span dir="ltr">
                  {formatMoneyAmount(vatAmountIls)} ₪ / ${formatMoneyAmount(vatAmountUsd)}
                </span>
              </div>
              <div className="adm-oc-line adm-oc-line--total adm-oc-pro-final">
                <span>סה״כ סופי</span>
                <span dir="ltr">{formatMoneyAmount(finalTotalIls)} ₪</span>
              </div>
            </Card>

            <Card className="summary-success adm-oc-legacy-card adm-oc-card--usd adm-oc-pro-card adm-oc-pro-card--usd">
              <div className="adm-oc-card-title adm-oc-pro-card-title adm-oc-pro-card-title--usd">$ דולרים</div>
              <div className="adm-field adm-oc-field adm-oc-legacy-fin-field">
                <label htmlFor={idp("dusd")}>סכום בדולר</label>
                <MoneyInput
                  id={idp("dusd")}
                  ref={usdInputRef}
                  className="adm-oc-inp adm-oc-legacy-fin-inp"
                  disabled={fieldDisabled}
                  placeholder="הקלד סכום..."
                  value={(() => {
                    const n = parseNum(dealUsdStr);
                    return Number.isFinite(n) ? n : null;
                  })()}
                  onChange={(n) => setDealUsdStr(n == null ? "" : String(n))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      paymentMethodRef.current?.focus();
                    }
                  }}
                />
              </div>
              <div className="adm-oc-line">
                <span>עמלה</span>
                <span dir="ltr">{formatMoneyAmount(commissionUsdEffective)} $</span>
              </div>
              <div className="adm-oc-line adm-oc-line--total">
                <span>סה״כ</span>
                <span dir="ltr">{formatMoneyAmount(totalUsdCalc)} $</span>
              </div>
            </Card>
          </div>
        </div>

        </div>

        <div className="adm-modal-actions adm-modal-actions--capture adm-oc-legacy-actions adm-oc-pro-actions">
          <button
            type="submit"
            className={`adm-oc-pro-save${isSaving ? " is-loading" : ""}`}
            disabled={isSaving || (isEdit ? !canEditOrders : !canCreateOrders) || formLocked}
            title="שמירה (Ctrl+Enter)"
          >
            <Save size={15} strokeWidth={2.2} aria-hidden />
            <span>{isSaving ? "שומר…" : isEdit ? "עדכון" : "שמור"}</span>
          </button>
          <span className="adm-oc-pro-shortcut-hint" aria-hidden>
            <kbd>Ctrl</kbd>
            <span>+</span>
            <kbd>Enter</kbd>
            <span>לשמירה מהירה</span>
          </span>
          <span className="adm-oc-pro-actions__spacer" />
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--dense adm-oc-pro-cancel"
            disabled={isSaving}
            onClick={onClose}
          >
            ביטול
          </button>
        </div>

        {editRequestOpen ? (
          <div
            className="adm-oc-edit-request-backdrop"
            role="presentation"
            onClick={() => {
              if (!editRequestBusy) setEditRequestOpen(false);
            }}
          >
            <div
              className="adm-oc-edit-request-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={idp("edit-req-title")}
              onClick={(e) => e.stopPropagation()}
              dir="rtl"
            >
              <h4 id={idp("edit-req-title")}>בקשת עריכה</h4>
              <label className="adm-field" htmlFor={idp("edit-req-reason")}>
                סיבת עריכה
                <textarea
                  id={idp("edit-req-reason")}
                  value={editRequestReason}
                  disabled={editRequestBusy}
                  onChange={(e) => setEditRequestReason(e.target.value)}
                  placeholder="למשל: תיקון סכום לפי אישור לקוח…"
                />
              </label>
              <div className="adm-oc-edit-request-modal-actions">
                <button
                  type="button"
                  className="adm-btn adm-btn--ghost adm-btn--dense"
                  disabled={editRequestBusy}
                  onClick={() => setEditRequestOpen(false)}
                >
                  ביטול
                </button>
                <button
                  type="button"
                  className={`adm-btn adm-btn--primary adm-btn--dense${editRequestBusy ? " loading" : ""}`}
                  disabled={editRequestBusy}
                  onClick={() => {
                    if (editRequestBusy || !editOrderId) return;
                    setEditRequestBusy(true);
                    setErr(null);
                    void createOrderEditRequestAction(editOrderId, editRequestReason).then((res) => {
                      setEditRequestBusy(false);
                      if (!res.ok) {
                        setErr(res.error);
                        return;
                      }
                      setEditRequestOpen(false);
                      setEditRequestFlash("הבקשה נשלחה למנהלים");
                      void getOrderForWorkPanelAction(editOrderId).then((row) => {
                        if (row) setEditGate(row.editGate);
                      });
                    });
                  }}
                >
                  {editRequestBusy ? "שולח…" : "שליחה"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}
