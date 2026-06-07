"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PaymentMethod } from "@prisma/client";
import { isDebtWithdrawalOrderStatus } from "@/lib/debt-withdrawal-order";
import { OS } from "@/lib/order-status-slugs";
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
  type CustomerSearchRow,
  type OrderWorkPanelPayload,
} from "@/app/admin/capture/actions";
import type { ClientCreateResult } from "@/app/admin/customers/ledger-types";
import type { CustomerExtrasPayload } from "@/app/api/customers/extras/route";
import { createOrderEditRequestAction } from "@/app/admin/order-edit-requests/actions";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import type { AdminToastFn } from "@/components/admin/AdminNavShell";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import Card from "@/components/ui/Card";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { AnimatedMoneyValue } from "@/components/ui/AnimatedMoneyValue";
import { CustomerBalanceView } from "@/components/ui/CustomerBalanceView";
import { parseBalanceAmountString } from "@/lib/customer-balance";
import { formatMoneyAmount, parseMoneyString } from "@/lib/money-format";
import type { OrderCaptureWindowProps } from "@/lib/admin-windows";

import { ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS } from "@/lib/order-capture-payment-methods";
import { orderCountryLabel, ORDER_COUNTRY_CODES, coerceOrderCountryForForm, type OrderCountryCode } from "@/lib/order-countries";
import { workCountryFromOrderSourceCountry } from "@/lib/work-country";
import { buildCaptureFinancialSnapshot } from "@/lib/capture-form-snapshot";
import { IntakeLocationCombobox } from "@/components/admin/IntakeLocationCombobox";
import { ErpSearchCombobox } from "@/components/admin/ErpCreatableCombobox";
import { loadFinancialSettingsForCaptureAction } from "@/app/admin/financial/actions";
import {
  WEGO_FINANCIAL_SETTINGS_SAVED,
  applyFinancialSettingsToCaptureUi,
} from "@/lib/financial-settings-bus";
import type { SerializedFinancial } from "@/lib/financial-settings";
import { FINANCE_DEFAULTS_CLIENT } from "@/lib/finance-settings-client";
import { VAT_RATE, VAT_RATE_PERCENT, formatVatPercentLabel } from "@/lib/vat";
import {
  commissionPercentFromOrderAmounts,
  formatCommissionPercentValue,
  parseCommissionPercentString,
  sanitizeCommissionPercentInput,
} from "@/lib/commission-percent";
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
import { useOrderStatusCatalog } from "@/components/admin/OrderStatusCatalogProvider";
import { OrderStatusSelect } from "@/components/admin/OrderStatusSelect";

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

async function loadCustomerExtrasFast(
  customerId: string,
  workCountry: string,
): Promise<CustomerExtrasPayload | null> {
  const q = new URLSearchParams({
    id: customerId,
    country: workCountry,
  });
  const res = await fetch(`/api/customers/extras?${q.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("טעינת פרטי לקוח נכשלה");
  return (await res.json()) as CustomerExtrasPayload | null;
}

import {
  findCustomerCaptureIndexExact,
  invalidateCustomerCaptureIndex,
  preloadCustomerCaptureIndex,
  searchCustomerCaptureIndexLocal,
} from "@/lib/customer-capture-index";
import { invalidateCustomerSearchClientCache } from "@/lib/customer-search-client";
import {
  CUSTOMER_CODE_SEARCH_DEBOUNCE_MS,
  CUSTOMER_NAME_SEARCH_DEBOUNCE_MS,
  pickAutoCustomerHit,
  resolveCustomerFastClient,
  searchCustomerCodeExactClient,
  searchCustomersFastClient,
} from "@/lib/customer-search-client";
import { CUSTOMER_SEARCH_UUID_RE } from "@/lib/customer-search-shared";

type OrderBootPayload = { countries: string[] };

type NextOrderNumberPayload = { weekCode: string; nextOrderNumber: string };

/** placeholder מיידי — המשתמש יכול להמשיך להזין בלי להמתין ל-API */
export function formatOrderNumberPlaceholder(weekCode: string): string {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const m = wc.match(/^AH-(\d{1,4})$/i);
  if (m) return `AH-${m[1]}-XXXX`;
  return `${wc}-XXXX`;
}

async function fetchOrderBootCountries(): Promise<OrderCountryCode[]> {
  const res = await fetch("/api/orders/boot", { credentials: "include" });
  if (!res.ok) return [];
  const data = (await res.json()) as OrderBootPayload;
  return Array.isArray(data.countries) ? (data.countries as OrderCountryCode[]) : [];
}

const nextNumberInflight = new Map<string, Promise<NextOrderNumberPayload | null>>();

async function fetchNextOrderNumber(
  weekCode: string,
  workCountry: string,
): Promise<NextOrderNumberPayload | null> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const cacheKey = `${workCountry}|${wc}`;
  const existing = nextNumberInflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const q = new URLSearchParams({ weekCode: wc, country: workCountry });
    const res = await fetch(`/api/orders/next-number?${q.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    return (await res.json()) as NextOrderNumberPayload;
  })().finally(() => {
    nextNumberInflight.delete(cacheKey);
  });

  nextNumberInflight.set(cacheKey, promise);
  return promise;
}

function captureExtrasFromPanel(
  financial: SerializedFinancial | null,
  displayFinalRate: number,
  cust: CustomerSearchRow,
  enabledCountries: OrderCountryCode[],
) {
  return {
    financialSnapshot: buildCaptureFinancialSnapshot(financial, displayFinalRate),
    customerSnapshot: {
      id: cust.id,
      customerCode: cust.code,
      displayName: cust.label,
      customerType: cust.customerType,
      nameAr: cust.nameAr ?? null,
      nameEn: cust.nameEn ?? null,
    },
    enabledCountries: enabledCountries.length > 0 ? enabledCountries : undefined,
  };
}

async function saveCaptureFast(payload: Record<string, unknown>): Promise<CaptureState> {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const t0 = now();
  const res = await fetch("/api/orders/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const fetchMs = Math.round(now() - t0);
  const serverActionMs = Number(res.headers.get("X-Capture-Action-Ms") ?? "");
  const serverResponseSentAt = res.headers.get("X-Capture-Response-Sent-At");
  const jsonT0 = now();
  const data = (await res.json().catch(() => null)) as CaptureState | null;
  const jsonMs = Math.round(now() - jsonT0);
  const totalMs = Math.round(now() - t0);
  const clientOverServerMs =
    Number.isFinite(serverActionMs) && serverActionMs > 0 ? fetchMs - serverActionMs : undefined;
  if (process.env.NODE_ENV === "development" || totalMs > 500) {
    console.log("[capture.client]", {
      mode: payload.mode,
      status: res.status,
      fetchMs,
      jsonMs,
      totalMs,
      serverActionMs: Number.isFinite(serverActionMs) ? serverActionMs : undefined,
      serverResponseSentAt,
      clientOverServerMs,
      afterFetchMs: totalMs - fetchMs,
      hint: "clientOverServerMs ≈ network+TLS; fetchMs should ≈ server apiMs",
    });
  }
  return data ?? { ok: false, error: "שגיאה בשמירה" };
}

function defaultCommissionPercentStr(f: SerializedFinancial | null): string {
  return formatCommissionPercentValue(parseCommissionPercentString(f?.defaultCommissionPercent ?? "0"));
}

function customerDisplayCode(c: CustomerSearchRow): string {
  const code = c.code?.trim();
  if (code) return code;
  return c.id.length > 14 ? `${c.id.slice(0, 10)}…` : c.id;
}

type Props = {
  windowId: string;
  financial: SerializedFinancial | null;
  onToast: AdminToastFn;
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
  const { globalWeek, globalCountry } = useAdminGlobal();
  useOrderStatusCatalog();
  const idp = (s: string) => `${windowId}-${s}`;

  const isEdit = target.mode === "edit";

  /** מקור אמת: FinancialSettings מהשרת — לא layout/cache */
  const [financeLive, setFinanceLive] = useState<SerializedFinancial | null>(null);
  const financeEffective = financeLive ?? financial;

  useEffect(() => {
    let cancelled = false;
    void loadFinancialSettingsForCaptureAction().then((data) => {
      if (!cancelled) setFinanceLive(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onSaved = (ev: Event) => {
      const data = (ev as CustomEvent<SerializedFinancial>).detail;
      if (!data) return;
      applyFinancialSettingsToCaptureUi(data, {
        isEdit,
        finalRateTouched: finalRateTouchedRef.current,
        commissionTouched: commissionPercentTouchedRef.current,
        setFinanceLive,
        setFinalRateStr,
        setCommissionPercentStr,
        formatCommission: defaultCommissionPercentStr,
      });
    };
    window.addEventListener(WEGO_FINANCIAL_SETTINGS_SAVED, onSaved);
    return () => window.removeEventListener(WEGO_FINANCIAL_SETTINGS_SAVED, onSaved);
  }, [isEdit]);

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
  const [commissionPercentStr, setCommissionPercentStr] = useState(() =>
    defaultCommissionPercentStr(financial),
  );
  const commissionPercentTouchedRef = useRef(false);
  const finalRateTouchedRef = useRef(false);
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

  const [finalRateStr, setFinalRateStr] = useState(() => {
    const f = financial?.finalDollarRate
      ? Number(String(financial.finalDollarRate).replace(",", "."))
      : NaN;
    return Number.isFinite(f) && f > 0 ? f.toFixed(4) : FINANCE_DEFAULTS_CLIENT.finalDollarRate;
  });
  const finalRate = useMemo(() => {
    const n = Number(String(finalRateStr).trim().replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [finalRateStr]);

  const systemDefaultCommissionStr = useMemo(
    () => defaultCommissionPercentStr(financeEffective),
    [financeEffective],
  );

  const commissionPct = useMemo(
    () => parseCommissionPercentString(commissionPercentStr),
    [commissionPercentStr],
  );

  const commissionPercentCustomized = useMemo(() => {
    const cur = formatCommissionPercentValue(commissionPct);
    return cur !== systemDefaultCommissionStr;
  }, [commissionPct, systemDefaultCommissionStr]);

  useEffect(() => {
    if (isEdit || commissionPercentTouchedRef.current) return;
    setCommissionPercentStr(systemDefaultCommissionStr);
  }, [isEdit, systemDefaultCommissionStr]);

  /** עדכון שער דולר כשנטענו FinancialSettings — רק אם המשתמש לא ערך ידנית */
  useEffect(() => {
    if (isEdit || finalRateTouchedRef.current || !financeLive) return;
    const raw = financeLive.finalDollarRate;
    const f = Number(String(raw).replace(",", "."));
    if (Number.isFinite(f) && f > 0) setFinalRateStr(f.toFixed(4));
  }, [isEdit, financeLive]);

  const [orderNumberPreview, setOrderNumberPreview] = useState(() =>
    formatOrderNumberPlaceholder(globalWeek || DEFAULT_WEEK_CODE),
  );

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
  const [orderStatus, setOrderStatus] = useState<string>(OS.OPEN);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [isSearching, setIsSearching] = useState(false);
  /** אחרי חיפוש קוד שלא נמצא — הצעה להוספת לקוח */
  const [customerCodeMissing, setCustomerCodeMissing] = useState(false);

  const customerCodeInputRef = useRef<HTMLInputElement | null>(null);
  const usdInputRef = useRef<HTMLInputElement | null>(null);
  const paymentMethodRef = useRef<HTMLSelectElement | null>(null);
  const [paymentPointId, setPaymentPointId] = useState("");
  const [paymentPointQuery, setPaymentPointQuery] = useState("");
  const [notes, setNotes] = useState("");

  const [dealUsdStr, setDealUsdStr] = useState("");
  const [dealIlsStr, setDealIlsStr] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [orderCountries, setOrderCountries] = useState<OrderCountryCode[]>([]);
  const [sourceCountry, setSourceCountry] = useState<OrderCountryCode | "">(() =>
    target.mode === "create" ? (globalCountry as OrderCountryCode) : "",
  );

  const countrySelectOptions = useMemo(() => [...ORDER_COUNTRY_CODES] as OrderCountryCode[], []);

  const countryComboboxOptions = useMemo(
    () =>
      countrySelectOptions
        .filter((c) => orderCountries.length === 0 || orderCountries.includes(c))
        .map((c) => ({ id: c, label: orderCountryLabel(c) })),
    [countrySelectOptions, orderCountries],
  );

  const previewWorkCountry = workCountryFromOrderSourceCountry(
    sourceCountry || globalCountry,
  );

  useEffect(() => {
    if (orderCountries.length === 0) return;
    if (isEdit) return;
    setSourceCountry((cur) =>
      cur && orderCountries.includes(cur) ? cur : orderCountries[0] ?? (ORDER_COUNTRY_CODES[0] as OrderCountryCode),
    );
  }, [orderCountries, isEdit, globalWeek]);

  // מדינות + אינדקס לקוחות — פעם אחת בפתיחה (לא תלוי בלקוח / שבוע)
  useEffect(() => {
    let cancelled = false;
    void fetchOrderBootCountries().then((countries) => {
      if (cancelled || countries.length === 0) return;
      setOrderCountries(countries);
    });
    void preloadCustomerCaptureIndex(previewWorkCountry);
    return () => {
      cancelled = true;
    };
  }, [previewWorkCountry]);

  // מספר הזמנה — placeholder מיידי, עדכון ברקע לפי מדינת עבודה (לא קשור לבחירת לקוח)
  useEffect(() => {
    if (isEdit) return;
    setOrderNumberPreview(formatOrderNumberPlaceholder(displayWeekCode));
    let cancelled = false;
    void fetchNextOrderNumber(displayWeekCode, previewWorkCountry).then((payload) => {
      if (cancelled || !payload?.nextOrderNumber) return;
      setOrderNumberPreview(payload.nextOrderNumber);
    });
    return () => {
      cancelled = true;
    };
  }, [isEdit, displayWeekCode, previewWorkCountry]);

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
      setNotes(row.notes);
      setDealUsdStr(row.amountUsd);
      setDealIlsStr("");
      setFinalRateStr(row.usdRateUsed?.trim() ? row.usdRateUsed.trim() : finalRateStr);
      setCommissionPercentStr(row.commissionPercent?.trim() ? row.commissionPercent.trim() : systemDefaultCommissionStr);
      commissionPercentTouchedRef.current = true;
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
  }, [isEdit, editOrderId, systemDefaultCommissionStr]);

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
    async (customerId: string) => {
      const req = ++customerExtrasReqRef.current;
      try {
        const ex = await loadCustomerExtrasFast(customerId, previewWorkCountry);
        if (customerExtrasReqRef.current !== req) return;
        if (!ex) {
          setExtras(null);
          setPhoneStr("");
          return;
        }
        applyExtras(ex);
      } catch {
        if (customerExtrasReqRef.current !== req) return;
        setExtras(null);
        setPhoneStr("");
        setErr("טעינת נתונים נכשלה");
      }
    },
    [applyExtras, previewWorkCountry],
  );

  useEffect(() => {
    if (!selectedCustomer) {
      setExtras(null);
      setPhoneStr("");
      return;
    }
    void loadCustomerExtras(selectedCustomer.id);
  }, [selectedCustomer, loadCustomerExtras]);

  useEffect(() => {
    const onBalancesRefresh = () => {
      const cid = selectedCustomer?.id?.trim();
      if (cid) void loadCustomerExtras(cid);
    };
    window.addEventListener("wego:balances-refresh", onBalancesRefresh);
    return () => window.removeEventListener("wego:balances-refresh", onBalancesRefresh);
  }, [selectedCustomer?.id, loadCustomerExtras]);

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

  const commissionUsdEffective = useMemo(() => commissionUsdCalc, [commissionUsdCalc]);

  const commissionIlsEffective = useMemo(() => commissionIlsCalc, [commissionIlsCalc]);

  const totalBeforeVatIls = useMemo(() => {
    if (!Number.isFinite(dealIlsTotal) || dealIlsTotal <= 0) return 0;
    return roundMoney2(dealIlsTotal + commissionIlsEffective);
  }, [dealIlsTotal, commissionIlsEffective]);

  const vatAmountIls = useMemo(() => roundMoney2(totalBeforeVatIls * VAT_RATE), [totalBeforeVatIls]);

  const finalTotalIls = useMemo(() => roundMoney2(totalBeforeVatIls + vatAmountIls), [totalBeforeVatIls, vatAmountIls]);

  const totalUsdCalc = useMemo(() => {
    if (!Number.isFinite(dealUsdTotal) || dealUsdTotal <= 0) return 0;
    return roundMoney2(dealUsdTotal + commissionUsdEffective);
  }, [dealUsdTotal, commissionUsdEffective]);

  const isDebtWithdrawalCapture = isDebtWithdrawalOrderStatus(orderStatus);
  const displayTotalUsd = isDebtWithdrawalCapture ? -Math.abs(totalUsdCalc) : totalUsdCalc;

  const pickCustomer = useCallback((row: CustomerSearchRow) => {
    skipSearchRef.current = true;
    setErr(null);
    setCustomerCodeMissing(false);
    setSelectedCustomer(row);
    setCodeStr(row.code?.trim() ? row.code.trim() : row.id);
    if (row.nameAr != null) setNameArStr(row.nameAr);
    if (row.nameEn != null) setNameEnStr(row.nameEn);
    setPhoneStr(row.phone ?? row.phone2 ?? "");
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
  }, [applyExtras]);

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
      setCustomerCodeMissing(false);
      setSelectedCustomer(row);
      setCodeStr(client.customerCode);
      setNameArStr(client.customerNameAr);
      setNameEnStr(client.customerNameEn ?? "");
      setPhoneStr(client.phone ?? "");
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
      invalidateCustomerSearchClientCache();
      invalidateCustomerCaptureIndex();
      queueMicrotask(() => {
        skipSearchRef.current = false;
      });
      onToast("הלקוח נוסף וחובר להזמנה בהצלחה", { variant: "success" });
      window.setTimeout(() => {
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
    },
    [applyExtras, onToast],
  );

  const openNewCustomerModal = useCallback(
    (presetCode?: string) => {
      if (!canCreateOrders) return;
      const code = (presetCode ?? codeStr).trim();
      setErr(null);
      openCreateCustomerForOrder(applyCreatedCustomer, code ? { initialCustomerCode: code } : undefined);
    },
    [canCreateOrders, codeStr, openCreateCustomerForOrder, applyCreatedCustomer],
  );

  /** חיפוש לקוח בלבד — לא טוען הזמנות / יתרות מחושבות / דוחות */
  useEffect(() => {
    if (skipSearchRef.current) return;
    const field = focusedComboRef.current;
    const q = field === "code" ? codeStr : field === "nameAr" ? nameArStr : nameEnStr;
    const trimmed = q.trim();
    const isUuid = CUSTOMER_SEARCH_UUID_RE.test(trimmed);
    const isNumericCode = field === "code" && /^\d+$/.test(trimmed);
    if (!trimmed || (!isUuid && !isNumericCode && trimmed.length < 2)) {
      setHits([]);
      setIsSearching(false);
      return;
    }

    const debounceMs =
      field === "code" ? CUSTOMER_CODE_SEARCH_DEBOUNCE_MS : CUSTOMER_NAME_SEARCH_DEBOUNCE_MS;
    const gen = ++searchGenRef.current;
    setIsSearching(true);

    const t = window.setTimeout(() => {
      void (async () => {
        const useConsoleTimer = typeof console !== "undefined" && typeof console.time === "function";
        if (useConsoleTimer) console.time("customer-search");
        try {
          let rows: CustomerSearchRow[] = searchCustomerCaptureIndexLocal(trimmed, field);

          const searchWc = previewWorkCountry;
          if (field === "code" && (isNumericCode || isUuid)) {
            if (rows.length === 0) {
              rows = await searchCustomerCodeExactClient(trimmed, { workCountry: searchWc });
            }
          } else if (rows.length === 0) {
            if (field === "code") {
              const exact = await searchCustomerCodeExactClient(trimmed, { workCountry: searchWc });
              rows =
                exact.length > 0
                  ? exact
                  : await searchCustomersFastClient(trimmed, { workCountry: searchWc });
            } else {
              rows = await searchCustomersFastClient(trimmed, { workCountry: searchWc });
            }
          }

          if (searchGenRef.current !== gen) return;

          const auto = pickAutoCustomerHit(rows, trimmed);
          if (auto && field === "code" && (isNumericCode || isUuid || rows.length === 1)) {
            pickCustomer(auto);
            return;
          }

          setHits(rows);
          setDropdownField(field);
        } catch {
          if (searchGenRef.current !== gen) return;
          setErr("טעינת נתונים נכשלה");
          setHits([]);
        } finally {
          if (useConsoleTimer) console.timeEnd("customer-search");
          if (searchGenRef.current === gen) setIsSearching(false);
        }
      })();
    }, debounceMs);

    return () => window.clearTimeout(t);
  }, [codeStr, nameArStr, nameEnStr, pickCustomer, previewWorkCountry]);

  const openFullList = useCallback(async (field: ComboField) => {
    focusedComboRef.current = field;
    const rows = await listCustomersForOrderQuickPickAction(previewWorkCountry);
    setHits(rows);
    setDropdownField(field);
  }, [previewWorkCountry]);

  const resolveExactCode = useCallback(
    async (opts?: { openCreateIfMissing?: boolean }) => {
      setErr(null);
      const raw = codeStr.trim();
      if (!raw) {
        setCustomerCodeMissing(false);
        setErr("הזינו קוד לקוח");
        return;
      }
      setIsSearching(true);
      try {
        const local = findCustomerCaptureIndexExact(raw);
        if (local) {
          pickCustomer(local);
          return;
        }
        const row = await resolveCustomerFastClient(raw);
        if (row) {
          pickCustomer(row);
          return;
        }
        setCustomerCodeMissing(true);
        if (opts?.openCreateIfMissing && canCreateOrders) {
          openNewCustomerModal(raw);
        }
      } finally {
        setIsSearching(false);
      }
    },
    [codeStr, pickCustomer, canCreateOrders, openNewCustomerModal],
  );

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
    setCommissionPercentStr(systemDefaultCommissionStr);
    commissionPercentTouchedRef.current = false;
    finalRateTouchedRef.current = false;
    setHits([]);
    setDropdownField(null);
    setIsSearching(false);
    setErr(null);
    setPaymentMethod(PaymentMethod.CASH);
    setOrderStatus(OS.OPEN);
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
  }, [systemDefaultCommissionStr]);

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
    commissionPercentStr,
    orderExecutionDateYmd,
    intakeDateYmd,
    intakeTimeHm,
    paymentMethod,
    orderStatus,
    notes,
    nameArStr,
    nameEnStr,
    financial: financeEffective,
    orderCountries,
    finalRate,
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
    commissionPercentStr,
    orderExecutionDateYmd,
    intakeDateYmd,
    intakeTimeHm,
    paymentMethod,
    orderStatus,
    notes,
    nameArStr,
    nameEnStr,
    financial: financeEffective,
    orderCountries,
    finalRate,
  };

  const performSave = useCallback(
    async (keepOpen: boolean) => {
      const s = performSaveStateRef.current;
      if (s.isSaving) return;
      if (s.isEdit && s.editGate?.employeeEditBlocked) return;

      let cust = s.selectedCustomer;
      if (!cust && s.codeStr.trim()) {
        const row = await resolveCustomerFastClient(s.codeStr.trim());
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
        setErr("מקום תשלום: יש לבחור מהרשימה או להזין לפחות שני תווים");
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

        const extras = captureExtrasFromPanel(s.financial, s.finalRate, cust, s.orderCountries);

        const savePayload = (feeStr: string) =>
          s.isEdit
            ? {
                mode: "update" as const,
                orderId: s.editOrderId,
                ...extras,
                orderExecutionDateYmd: s.orderExecutionDateYmd,
                intakeDateYmd: s.intakeDateYmd,
                intakeTimeHm: s.intakeTimeHm,
                customerId: cust.id,
                amountUsd: roundMoney2(s.dealUsdTotal).toFixed(2),
                feeUsd: feeStr,
                commissionPercent: s.commissionPercentStr,
                finalRateOverride: s.finalRate > 0 ? String(s.finalRate) : null,
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
              }
            : {
                mode: "create" as const,
                ...extras,
                orderExecutionDateYmd: s.orderExecutionDateYmd,
                intakeDateYmd: s.intakeDateYmd,
                intakeTimeHm: s.intakeTimeHm,
                customerId: cust.id,
                amountUsd: roundMoney2(s.dealUsdTotal).toFixed(2),
                feeUsd: feeStr,
                commissionPercent: s.commissionPercentStr,
                finalRateOverride: s.finalRate > 0 ? String(s.finalRate) : null,
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
              };

        if (s.isEdit) {
          const feeStr = s.commissionUsdEffective.toFixed(2);
          const res = await saveCaptureFast(savePayload(feeStr));
          if (!res.ok) throw new Error(res.error);
          setIsSaving(false);
          onToast("ההזמנה נשמרה");
          if (keepOpen) {
            /* stay open */
          } else {
            onClose();
          }
          queueMicrotask(() => {
            window.dispatchEvent(new CustomEvent("wego:balances-refresh"));
            onSaved?.();
          });
        } else {
          const feeStr = s.commissionUsdCalc.toFixed(2);
          const res = await saveCaptureFast(savePayload(feeStr));
          if (!res.ok) throw new Error(res.error);
          setIsSaving(false);
          onToast("ההזמנה נשמרה");
          if (res.nextOrderNumberPreview) {
            setOrderNumberPreview(res.nextOrderNumberPreview);
          }
          if (keepOpen) {
            resetFormForNew();
          } else {
            onClose();
          }
          queueMicrotask(() => {
            window.dispatchEvent(new CustomEvent("wego:balances-refresh"));
            onSaved?.();
          });
        }
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "שגיאה בשמירה";
        setErr(msg);
        onToast("שגיאה בשמירה");
      } finally {
        setIsSaving(false);
      }
    },
    [pickCustomer, onToast, onSaved, onClose, resetFormForNew],
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
                  onClick={() => openNewCustomerModal()}
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
            <ErpSearchCombobox
              id={idp("country")}
              className="adm-oc-country-combo"
              inputClassName="adm-oc-legacy-top-sel"
              value={sourceCountry}
              label={sourceCountry ? orderCountryLabel(sourceCountry) : ""}
              disabled={fieldDisabled}
              entityName="מדינה"
              placeholder="בחרו או חפשו מדינה…"
              options={countryComboboxOptions}
              onChange={(id) => {
                closeCustomerDropdown();
                setSourceCountry(id as OrderCountryCode);
              }}
            />
          </span>
          <span className="adm-oc-legacy-topbar-item adm-oc-pro-item">
            <label className="adm-oc-legacy-micro-label adm-oc-pro-mlbl">
              <DollarSign size={12} strokeWidth={2.2} aria-hidden /> שער דולר
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="adm-oc-legacy-top-inp adm-oc-pro-inp"
              value={finalRateStr}
              dir="ltr"
              disabled={fieldDisabled}
              title="שער דולר להזמנה זו (ננעל לאחר שמירה)"
              onChange={(e) => { finalRateTouchedRef.current = true; setFinalRateStr(e.target.value); }}
            />
          </span>
          <span className="adm-oc-legacy-topbar-item adm-oc-pro-item">
            <label className="adm-oc-legacy-micro-label adm-oc-pro-mlbl">
              <Percent size={12} strokeWidth={2.2} aria-hidden /> עמלה %
            </label>
            <input
              type="text"
              inputMode="decimal"
              className={
                commissionPercentCustomized
                  ? "adm-oc-legacy-top-inp adm-oc-pro-inp adm-oc-pro-inp--commission-override"
                  : "adm-oc-legacy-top-inp adm-oc-pro-inp"
              }
              value={commissionPercentStr}
              dir="ltr"
              disabled={fieldDisabled}
              title={
                commissionPercentCustomized
                  ? "עמלה מותאמת להזמנה זו (ברירת מחדל מערכת: " + systemDefaultCommissionStr + "%)"
                  : "אחוז עמלה — ברירת מחדל מערכת: " + systemDefaultCommissionStr + "%"
              }
              onChange={(e) => {
                commissionPercentTouchedRef.current = true;
                setCommissionPercentStr(sanitizeCommissionPercentInput(e.target.value));
              }}
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
                    const v = e.target.value;
                    setCodeStr(v);
                    setCustomerCodeMissing(false);
                    const curCode = selectedCustomer?.code?.trim() || "";
                    if (selectedCustomer && v.trim() !== curCode && v.trim() !== selectedCustomer.id) {
                      setSelectedCustomer(null);
                      setExtras(null);
                      setPhoneStr("");
                    }
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
                      void resolveExactCode({ openCreateIfMissing: true });
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
            {!isEdit && customerCodeMissing && codeStr.trim() && !selectedCustomer && canCreateOrders ? (
              <div className="adm-oc-missing-customer" role="status" aria-live="polite">
                <p className="adm-oc-missing-customer__msg">הלקוח לא קיים — להוסיף לקוח חדש?</p>
                <button
                  type="button"
                  className="adm-oc-missing-customer__btn"
                  disabled={fieldDisabled}
                  onClick={() => openNewCustomerModal()}
                >
                  <Plus size={15} strokeWidth={2.4} aria-hidden />
                  <span>לקוח חדש</span>
                </button>
              </div>
            ) : null}
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
                  <OrderStatusSelect
                    id={idp("ord-st")}
                    className="adm-oc-legacy-side-sel"
                    disabled={fieldDisabled}
                    value={orderStatus}
                    includeCurrentValue
                    onChange={(v) => {
                      closeCustomerDropdown();
                      setOrderStatus(v);
                    }}
                  />
                  {isDebtWithdrawalCapture ? (
                    <p className="adm-oc-debt-withdrawal-hint" role="note">
                      משיכה מחוב — הסכום יירשם כזיכוי ויקטין את חוב הלקוח (לא כחיוב).
                    </p>
                  ) : null}
                </div>
                <div className="adm-oc-legacy-side-field">
                  <label htmlFor={idp("pay-pt")}>מקום תשלום</label>
                  <IntakeLocationCombobox
                    id={idp("pay-pt")}
                    className="adm-oc-intake-combobox"
                    inputClassName="adm-oc-legacy-side-sel adm-oc-intake-combobox-input"
                    disabled={fieldDisabled}
                    value={paymentPointId}
                    label={paymentPointQuery}
                    onChange={(id, locLabel) => {
                      closeCustomerDropdown();
                      setPaymentPointId(id);
                      setPaymentPointQuery(locLabel);
                    }}
                  />
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
                <AnimatedMoneyValue
                  className="adm-oc-xrate-val money-amount"
                  dir="ltr"
                  value={`$${formatMoneyAmount(roundMoney2(eqUsdFromIls))}`}
                />
              </div>
              <div className="adm-oc-line adm-oc-money-line adm-oc-money-line--tier-2 adm-oc-money-line--commission">
                <span className="adm-oc-money-label commission-label">עמלה</span>
                <AnimatedMoneyValue
                  className="adm-oc-money-value adm-oc-money-value--ils commission-value"
                  dir="ltr"
                  value={`${formatMoneyAmount(commissionIlsEffective)} ₪`}
                />
              </div>
              <div className="adm-oc-line adm-oc-money-line adm-oc-money-line--tier-2 adm-oc-money-line--neutral">
                <span className="adm-oc-money-label">סה״כ לפני עמלה</span>
                <AnimatedMoneyValue
                  className="adm-oc-money-value adm-oc-money-value--ils"
                  dir="ltr"
                  value={`${formatMoneyAmount(roundMoney2(dealIlsTotal))} ₪`}
                />
              </div>
              <div className="adm-oc-line adm-oc-money-line adm-oc-money-line--tier-2 adm-oc-money-line--primary">
                <span className="adm-oc-money-label summary-primary-label">סה״כ לפני מע״מ</span>
                <AnimatedMoneyValue
                  className="adm-oc-money-value adm-oc-money-value--ils summary-primary-value"
                  dir="ltr"
                  value={`${formatMoneyAmount(totalBeforeVatIls)} ₪`}
                />
              </div>
              <div className="adm-oc-line adm-oc-money-line adm-oc-money-line--tier-2 adm-oc-money-line--vat">
                <span className="adm-oc-money-label">{formatVatPercentLabel()}</span>
                <AnimatedMoneyValue
                  className="adm-oc-money-value adm-oc-money-value--ils"
                  dir="ltr"
                  value={`${formatMoneyAmount(vatAmountIls)} ₪`}
                />
              </div>
              <div className="adm-oc-line adm-oc-line--total adm-oc-pro-final adm-oc-money-line adm-oc-money-line--hero summary-total">
                <span className="adm-oc-money-label summary-total-label">סה״כ סופי</span>
                <AnimatedMoneyValue
                  className="adm-oc-money-value adm-oc-money-value--ils summary-total-value"
                  dir="ltr"
                  value={`${formatMoneyAmount(finalTotalIls)} ₪`}
                />
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
              <div className="adm-oc-line adm-oc-money-line adm-oc-money-line--tier-2 adm-oc-money-line--commission">
                <span className="adm-oc-money-label commission-label">עמלה</span>
                <AnimatedMoneyValue
                  className="adm-oc-money-value adm-oc-money-value--usd commission-value"
                  dir="ltr"
                  value={`${formatMoneyAmount(commissionUsdEffective)} $`}
                />
              </div>
              <div className="adm-oc-line adm-oc-line--total adm-oc-money-line adm-oc-money-line--hero summary-total">
                <span className="adm-oc-money-label summary-total-label">סה״כ</span>
                <AnimatedMoneyValue
                  className={[
                    "adm-oc-money-value",
                    "adm-oc-money-value--usd",
                    "summary-total-value",
                    isDebtWithdrawalCapture ? "adm-oc-money-value--debt-withdrawal" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  dir="ltr"
                  value={`${formatMoneyAmount(displayTotalUsd)} $`}
                />
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
