"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { PaymentMethod } from "@prisma/client";
import {
  allocatePaymentAcrossOrders,
  buildAllocationsFromMatch,
  matchPaymentToOrders,
  orderLedgerBalanceUsd,
  paymentLedgerStatus,
  paymentLedgerStatusLabel,
  toPaymentIntakeBases,
  type PaymentIntakeMatchResult,
  type PaymentIntakeOrderRow,
  type PaymentLedgerStatus,
} from "@/lib/payment-intake";
import type { PaymentOveragePreview } from "@/lib/customer-balance";
import {
  fetchPaymentIntakeCustomerOrdersAction,
  fetchOrderPaymentHistoryAction,
  type OrderPaymentHistoryRow,
  type PaymentIntakeCustomerPayload,
  type PaymentIntakeCustomerPaymentRow,
} from "@/app/admin/payments/intake/actions";
import { sumCustomerPaymentsUsd } from "@/lib/payment-intake-customer-kpi";
import { aggregateLivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import { PaymentLiveSummaryCards } from "@/components/admin/PaymentLiveSummaryCards";
import { PaymentOpenDebtDetailModal } from "@/components/admin/PaymentOpenDebtDetailModal";
import {
  computePaymentIntakeLiveTotals,
  formatIntakeLiveBalanceDisplay,
  type CommissionResetOrderPreview,
} from "@/lib/payment-intake-live-calculator";
import { planCommissionDebtClosureFromNumbers } from "@/lib/commission-debt-closure";
import {
  fetchOrderForPaymentContextAction,
  previewPaymentCodeForCaptureAction,
  type CustomerSearchRow,
} from "@/app/admin/capture/actions";
import { loadFinancialSettingsForPaymentCaptureAction } from "@/app/admin/financial/actions";
import { WEGO_FINANCIAL_SETTINGS_SAVED } from "@/lib/financial-settings-bus";
import type { SerializedFinancial } from "@/lib/financial-settings";
import type { PaymentWindowProps } from "@/lib/admin-windows";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { OrderEditModal } from "@/components/admin/OrderEditModal";
import { Button } from "@/components/ui/Button";
import { normalizeOrderSourceCountry, type OrderCountryCode } from "@/lib/order-countries";
import {
  DEFAULT_WEEK_CODE,
  WORK_WEEK_CODES_SORTED,
  WORK_WEEK_RANGES,
  formatLocalHm,
  formatLocalYmd,
  getAhWeekRange,
  getWeekCodeForLocalDate,
  normalizeAhWeekCode,
  parseLocalDate,
} from "@/lib/work-week";
import { AhWeekNavNextButton, AhWeekNavPrevButton } from "@/components/admin/AhWeekNavButtons";
import { goToNextWeekNumber, goToPrevWeekNumber } from "@/lib/weeks/ah-week-nav";
import {
  calculateTotalBaseIls,
  calculateTotals,
  createDefaultPaymentLine,
  DEFAULT_VAT_RATE,
  roundMoney2,
  type PaymentLine,
  type PaymentLineCheck,
} from "@/lib/payment-updated";
import { PaymentLineDualCard } from "@/components/admin/PaymentLineDualCard";
import { validatePaymentCheckLines } from "@/lib/payment-checks";
import { formatCommissionPercentValue, parseCommissionPercentString } from "@/lib/commission-percent";
import {
  previewCustomerPaymentOverageAction,
  cancelPaymentAction,
  savePaymentUpdatedAction,
} from "@/app/admin/payments-updated/actions";
import { CustomerPaymentOverageModal } from "@/components/admin/CustomerPaymentOverageModal";
import {
  formatIlsDisplay,
  formatMoneyAmount,
  formatMoneyRate,
  formatUsdDisplay,
  parseMoneyStringOrZero,
  sanitizeMoneyInput,
} from "@/lib/money-format";
import { AnimatedMoneyValue } from "@/components/ui/AnimatedMoneyValue";
import {
  cancelCustomerSearch,
  CUSTOMER_SEARCH_DEBOUNCE_MS,
  customerSearchMinQueryLength,
  pickAutoCustomerHit,
  resolveCustomerFastClient,
  searchCustomerCodeExactClient,
  searchCustomersFastClient,
} from "@/lib/customer-search-client";

const COUNTRY_BADGE_SHORT: Record<OrderCountryCode, string> = {
  TURKEY: "טורקיה",
  CHINA: "סין",
  UAE: "אמירויות",
  JORDAN: "ירדן",
};

type BadgeEditField = "week" | "country" | "date" | "time" | null;

type CustFieldKey = "code" | "displayName" | "nameEn" | "nameAr" | "phone" | "index";

const EMPTY_CUSTOMER_DRAFT: Record<CustFieldKey, string> = {
  code: "",
  displayName: "",
  nameEn: "",
  nameAr: "",
  phone: "",
  index: "",
};

function weekCodeFromYmd(ymd: string): string {
  try {
    return getWeekCodeForLocalDate(parseLocalDate(ymd));
  } catch {
    return "—";
  }
}

function isTodayYmd(ymd: string): boolean {
  return ymd === formatLocalYmd(new Date());
}

function parseFinalRate(financial: SerializedFinancial | null | undefined): number {
  const raw = financial?.finalDollarRate?.replace(",", ".");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 3.5;
}

function parseNum(s: string): number {
  return parseMoneyStringOrZero(s);
}

/**
 * סניטיזציה של "אחוז עמלה": ספרות + נקודה עשרונית בודדת, ללא סימן %,
 * נחתך ל-100% (0..100) שכן אחוז עמלה גבוה יותר אינו הגיוני כאן.
 */
function sanitizePercentInput(raw: string): string {
  let t = raw.replace(/[^\d.]/g, "");
  const parts = t.split(".");
  if (parts.length > 2) t = parts[0] + "." + parts.slice(1).join("");
  if (t === "" || t === ".") return t;
  const n = Number(t);
  if (Number.isFinite(n) && n > 100) return "100";
  return t;
}

/**
 * מכפיל את סכום ההזמנה באחוז העמלה לתצוגה בלבד.
 * amountUsd * (1 + pct/100). אחוז שלילי או לא תקין → אין שינוי.
 * שימוש בעמודת "$ סכום" בטבלת ההזמנות.
 */
function applyCommissionPercentDisplay(amountUsd: number, pct: number): number {
  if (!Number.isFinite(amountUsd)) return amountUsd;
  if (!Number.isFinite(pct) || pct <= 0) return amountUsd;
  return amountUsd + (amountUsd * pct) / 100;
}

const fmtUsdDisplay = formatUsdDisplay;
const fmtIlsDisplay = formatIlsDisplay;
const fmtFooterAmount = formatMoneyAmount;
const fmtRate = formatMoneyRate;

function formatSlashDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

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

function countryBadgeFromOrders(rows: PaymentIntakeOrderRow[]): string {
  const codes = rows.map((r) => r.sourceCountry).filter((c): c is string => !!c?.trim());
  if (codes.length === 0) return "—";
  const normalized = [...new Set(codes.map((c) => normalizeOrderSourceCountry(c)).filter(Boolean))];
  if (normalized.length === 0) return "—";
  if (normalized.length > 1) return "מעורב";
  const n = normalized[0]!;
  if (n === "TURKEY") return "טורקיה";
  if (n === "CHINA") return "סין";
  if (n === "UAE") return "אמירויות";
  return "—";
}

function newLineId(): string {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function newCheckLineId(): string {
  return `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function emptyCheckRow(): PaymentLineCheck {
  return { id: newCheckLineId(), checkNumber: "", dueDateYmd: "", amount: "" };
}

/** מספר צ׳יק — ספרות בלבד */
function sanitizeCheckNumberInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 24);
}

function checkFieldMissingNumber(ch: PaymentLineCheck): boolean {
  return !String(ch.checkNumber ?? "").trim();
}

function checkFieldMissingDue(ch: PaymentLineCheck): boolean {
  const y = (ch.dueDateYmd ?? "").trim();
  return !y || !/^\d{4}-\d{2}-\d{2}$/.test(y);
}

function checkFieldMissingAmount(ch: PaymentLineCheck): boolean {
  const a = typeof ch.amount === "number" && Number.isFinite(ch.amount) ? ch.amount : NaN;
  return !Number.isFinite(a) || a <= 0;
}

function createDefaultLine(): PaymentLine {
  return createDefaultPaymentLine(newLineId());
}

type Props = {
  financial: SerializedFinancial | null;
  onToast: (msg: string) => void;
  initialPayment?: PaymentWindowProps;
  resetOnKey?: string | number;
  canViewCustomerCard?: boolean;
  canEditOrders?: boolean;
  canCreateOrders?: boolean;
  /** רק מנהל יכול לאפס יתרה ולמחוק חוב כנגד עמלות */
  viewerIsAdmin?: boolean;
};

type PaymentNavUnsavedDirection = "prev" | "next";

type PaymentEntryNavigation = {
  currentPaymentId: string;
  currentPaymentCode: string | null;
  currentPaymentNumber: number | null;
  previousPaymentId: string | null;
  nextPaymentId: string | null;
};

type PaymentEntryLoadResponse = PaymentEntryResponse & {
  navigation: PaymentEntryNavigation;
};

type PaymentEntryResponse = {
  id: string;
  paymentCode: string | null;
  paymentNumber?: number | null;
  paymentDateYmd: string;
  paymentTimeHm: string;
  dollarRate: string | null;
  /** אחוז עמלה שנשמר בקליטה — לתצוגה בטבלה; אופציונלי בטעינה ישנה */
  commissionPercent?: string | null;
  status?: "ACTIVE" | "CANCELLED";
  cancelReason?: string | null;
  customer: {
    id: string;
    displayName: string;
    customerCode: string;
    customerIndex: string;
    nameEn: string;
    nameAr: string;
    phone: string;
  };
  lines: PaymentLine[];
};

/** קליטה חדשה — עדיין אין שורת DB; השרת מקצה קוד מספרי לפני שמירה */
const NEW_CAPTURE_ROW_ID = "";

function createNewCaptureLoadedPayment(paymentCode: string): PaymentEntryResponse {
  const now = new Date();
  return {
    id: NEW_CAPTURE_ROW_ID,
    paymentCode,
    paymentDateYmd: formatLocalYmd(now),
    paymentTimeHm: formatLocalHm(now),
    dollarRate: null,
    customer: {
      id: "",
      displayName: "",
      customerCode: "",
      customerIndex: "",
      nameEn: "",
      nameAr: "",
      phone: "",
    },
    lines: [],
  };
}

function clonePaymentEntry(e: PaymentEntryResponse): PaymentEntryResponse {
  return {
    ...e,
    customer: { ...e.customer },
    lines: e.lines.map((l) => ({
      ...l,
      checks: l.checks?.map((c) => ({ ...c })),
    })),
  };
}

export function PaymentModalUpdated({
  financial,
  onToast,
  initialPayment,
  resetOnKey,
  canViewCustomerCard = true,
  canEditOrders = true,
  canCreateOrders = true,
  viewerIsAdmin = false,
}: Props) {
  const router = useRouter();
  const { globalWeek } = useAdminGlobal();
  const [financeLive, setFinanceLive] = useState<SerializedFinancial | null>(null);
  const financeEffective = financeLive ?? financial;

  useEffect(() => {
    let cancelled = false;
    void loadFinancialSettingsForPaymentCaptureAction().then((data) => {
      if (!cancelled) setFinanceLive(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultRate = useMemo(() => parseFinalRate(financeEffective), [financeEffective]);
  const { openWindow, closeTop } = useAdminWindows();

  /**
   * פוקוס מהיר: קוד לקוח → Enter (חיפוש + בחירה) → סכום → Enter → שמור וחדש → Enter
   */
  const customerCodeInputRef = useRef<HTMLInputElement | null>(null);
  const firstAmountInputRef = useRef<HTMLInputElement | null>(null);
  const saveAndNewButtonRef = useRef<HTMLButtonElement | null>(null);
  const savePrimaryButtonRef = useRef<HTMLButtonElement | null>(null);

  const [draftCustomer, setDraftCustomer] = useState<Record<CustFieldKey, string>>(() => ({
    ...EMPTY_CUSTOMER_DRAFT,
  }));
  const lastEditedFieldRef = useRef<CustFieldKey>("code");
  const draftCustomerRef = useRef(draftCustomer);
  draftCustomerRef.current = draftCustomer;
  const custSearchGenRef = useRef(0);

  const [editingBadge, setEditingBadge] = useState<BadgeEditField>(null);
  const [countryOverride, setCountryOverride] = useState<"AUTO" | OrderCountryCode>("AUTO");

  const [custDdOpen, setCustDdOpen] = useState(false);
  const [custSearchNoHits, setCustSearchNoHits] = useState(false);
  const [custSearching, setCustSearching] = useState(false);
  const [custSearchField, setCustSearchField] = useState<CustFieldKey | null>(null);
  const [searchTick, setSearchTick] = useState(0);
  const [customerHits, setCustomerHits] = useState<CustomerSearchRow[]>([]);
  const [customer, setCustomer] = useState<PaymentIntakeCustomerPayload | null>(null);
  const [customerPayments, setCustomerPayments] = useState<PaymentIntakeCustomerPaymentRow[]>([]);
  const [orders, setOrders] = useState<PaymentIntakeOrderRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [customerCodeEnterBusy, setCustomerCodeEnterBusy] = useState(false);
  const [orderEditId, setOrderEditId] = useState<string | null>(null);
  const [paymentHistoryOrderId, setPaymentHistoryOrderId] = useState<string | null>(null);
  const [paymentHistoryRows, setPaymentHistoryRows] = useState<OrderPaymentHistoryRow[]>([]);
  const [paymentHistoryBusy, setPaymentHistoryBusy] = useState(false);
  const [paymentHistoryErr, setPaymentHistoryErr] = useState<string | null>(null);

  /** קליטה שנטענה מ־GET /api/payments/entry או מעטפת קליטה חדשה */
  const [loadedPayment, setLoadedPayment] = useState<PaymentEntryResponse>(() => createNewCaptureLoadedPayment(""));
  /** קוד תשלום לתצוגה בלבד — נטען ברקע, לא מעדכן את loadedPayment (מונע remount / איבוד פוקוס) */
  const [previewPaymentCode, setPreviewPaymentCode] = useState<string | null>(null);
  const [paymentCodePreviewPending, setPaymentCodePreviewPending] = useState(true);
  const [paymentDateYmd, setPaymentDateYmd] = useState(() => {
    const today = new Date();
    const currentCode = getWeekCodeForLocalDate(today);
    if (globalWeek === currentCode) return formatLocalYmd(today);
    return WORK_WEEK_RANGES[globalWeek]?.from ?? formatLocalYmd(today);
  });
  const [paymentTimeHm, setPaymentTimeHm] = useState(() => formatLocalHm(new Date()));
  const baseWeekNumber = useMemo(() => parseWeekNumber(globalWeek) ?? parseWeekNumber(DEFAULT_WEEK_CODE) ?? 1, [globalWeek]);
  const baseDate = useMemo(
    () => new Date(WORK_WEEK_RANGES[globalWeek]?.from ?? WORK_WEEK_RANGES[DEFAULT_WEEK_CODE]?.from ?? formatLocalYmd(new Date())),
    [globalWeek],
  );
  const [weekDraft, setWeekDraft] = useState(() => globalWeek);
  const [weekInputErr, setWeekInputErr] = useState<string | null>(null);

  const dollarRateTouchedRef = useRef(false);
  const commissionPercentTouchedRef = useRef(false);
  const [dollarRate, setDollarRate] = useState(() => defaultRate.toFixed(4));
  /** אחוז עמלה ברירת מחדל מהמערכת */
  const systemCommissionPercentStr = useMemo(
    () =>
      formatCommissionPercentValue(
        parseCommissionPercentString(financeEffective?.defaultCommissionPercent ?? "0"),
      ),
    [financeEffective?.defaultCommissionPercent],
  );
  /** אחוז עמלה לקליטה הנוכחית (נשמר על Payment) */
  const [commissionPercentStr, setCommissionPercentStr] = useState(() => systemCommissionPercentStr);
  const commissionPercentN = useMemo(
    () => parseCommissionPercentString(commissionPercentStr),
    [commissionPercentStr],
  );

  const [payments, setPayments] = useState<PaymentLine[]>(() => [createDefaultLine()]);

  const [includedIds, setIncludedIds] = useState<string[] | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [overageModalOpen, setOverageModalOpen] = useState(false);
  const [overagePreview, setOveragePreview] = useState<PaymentOveragePreview | null>(null);
  const saveAfterOverageRef = useRef<"new" | "close" | null>(null);
  /** אחרי ניסיון שמירה שנכשל באימות צ׳יקים — מסמן שדות חסרים */
  const [highlightInvalidCheckFields, setHighlightInvalidCheckFields] = useState(false);
  const [resetCustomerConfirmOpen, setResetCustomerConfirmOpen] = useState(false);
  const baselineSigRef = useRef<string>("");
  const currentSigRef = useRef<string>("");
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  /** תצוגת "איפוס יתרה" — ללא שינוי DB/טבלה עד שמירת תשלום */
  const [customerBalanceResetPending, setCustomerBalanceResetPending] = useState(false);
  const [previousPaymentId, setPreviousPaymentId] = useState<string | null>(null);
  const [nextPaymentId, setNextPaymentId] = useState<string | null>(null);
  const [paymentNavLoading, setPaymentNavLoading] = useState(false);
  const [navUnsavedOpen, setNavUnsavedOpen] = useState<PaymentNavUnsavedDirection | null>(null);
  const [commissionResetIds, setCommissionResetIds] = useState<string[]>([]);
  const [cancelPaymentOpen, setCancelPaymentOpen] = useState(false);
  const [cancelPaymentBusy, setCancelPaymentBusy] = useState(false);
  const [cancelReasonDraft, setCancelReasonDraft] = useState("");
  const [openDebtDetailOpen, setOpenDebtDetailOpen] = useState(false);
  const [commissionResetTarget, setCommissionResetTarget] = useState<{
    orderId: string;
    orderNumber: string | null;
    oldCommissionUsd: number;
    remainingUsd: number;
    newCommissionUsd: number;
  } | null>(null);

  const customerIdRef = useRef<string | null>(null);
  customerIdRef.current = customer?.id ?? null;

  const initialAppliedRef = useRef(false);

  const rateN = parseNum(dollarRate);

  const totals = useMemo(() => calculateTotals(payments, rateN, DEFAULT_VAT_RATE), [payments, rateN]);

  const stickyIlsEntered = useMemo(
    () => calculateTotalBaseIls(payments, rateN, DEFAULT_VAT_RATE),
    [payments, rateN],
  );

  const currentDraftSig = useMemo(
    () =>
      JSON.stringify({
        customerId: customer?.id ?? "",
        paymentDateYmd,
        paymentTimeHm,
        dollarRate,
        includedIds: includedIds ?? [],
        nameEn: draftCustomer.nameEn.trim(),
        nameAr: draftCustomer.nameAr.trim(),
        phone: draftCustomer.phone.trim(),
        payments,
      }),
    [customer?.id, paymentDateYmd, paymentTimeHm, dollarRate, includedIds, draftCustomer.nameEn, draftCustomer.nameAr, draftCustomer.phone, payments],
  );

  const commissionResetPreview = useMemo((): CommissionResetOrderPreview[] => {
    if (commissionResetIds.length === 0) return [];
    const reset = new Set(commissionResetIds);
    return orders
      .filter((o) => reset.has(o.id))
      .map((o) => ({
        id: o.id,
        totalAmountUsd: Number(o.totalAmountUsd) || 0,
        dbPaidUsd: Number(o.dbPaidUsd) || 0,
        commissionUsd: Number(o.commissionUsd) || 0,
      }));
  }, [commissionResetIds, orders]);

  const customerBalanceResetPreview = useMemo((): CommissionResetOrderPreview[] => {
    if (!customerBalanceResetPending) return [];
    return orders
      .filter((o) => {
        const rem = Math.max(0, Number(o.totalAmountUsd) - Number(o.dbPaidUsd));
        return rem > 0.01;
      })
      .map((o) => ({
        id: o.id,
        totalAmountUsd: Number(o.totalAmountUsd) || 0,
        dbPaidUsd: Number(o.dbPaidUsd) || 0,
        commissionUsd: Number(o.commissionUsd) || 0,
      }));
  }, [customerBalanceResetPending, orders]);

  const bases = useMemo(() => {
    if (commissionResetIds.length === 0) return toPaymentIntakeBases(orders);
    const reset = new Set(commissionResetIds);
    return toPaymentIntakeBases(
      orders.map((o) => {
        if (!reset.has(o.id)) return o;
        const plan = planCommissionDebtClosureFromNumbers({
          commissionUsd: Number(o.commissionUsd) || 0,
          totalUsd: Number(o.totalAmountUsd) || 0,
          paidUsd: Number(o.dbPaidUsd) || 0,
        });
        return {
          ...o,
          commissionUsd: plan.afterCommissionUsd.toFixed(2),
          totalAmountUsd: plan.afterTotalUsd.toFixed(2),
        };
      }),
    );
  }, [commissionResetIds, orders]);

  const prioritizedSet = useMemo(() => {
    if (includedIds === null) return null;
    return new Set(includedIds);
  }, [includedIds]);

  const matched = useMemo(() => {
    return matchPaymentToOrders(bases, totals.totalUsd, prioritizedSet);
  }, [bases, totals.totalUsd, prioritizedSet]);

  const weekReadonly = useMemo(() => weekCodeFromYmd(paymentDateYmd), [paymentDateYmd]);

  /** קליטה שמורה ב־DB — מקור הניווט היחיד לרשומות Payment Entry */
  const savedCapturePaymentId = useMemo(() => {
    const id = loadedPayment?.id?.trim();
    if (!id || id === NEW_CAPTURE_ROW_ID) return null;
    return id;
  }, [loadedPayment?.id]);

  const displayedPaymentCode = useMemo(() => {
    const id = loadedPayment?.id?.trim();
    if (id && id !== NEW_CAPTURE_ROW_ID) {
      return (loadedPayment?.paymentCode ?? "").trim();
    }
    return (previewPaymentCode ?? "").trim();
  }, [loadedPayment?.id, loadedPayment?.paymentCode, previewPaymentCode]);

  /** עדכון שער דולר + עמלה כשנטענו FinancialSettings מהשרת */
  useEffect(() => {
    if (dollarRateTouchedRef.current || !financeLive) return;
    const raw = financeLive.finalDollarRate?.replace(",", ".");
    if (!raw) return;
    const f = Number(raw);
    if (Number.isFinite(f) && f > 0) setDollarRate(f.toFixed(4));
  }, [financeLive]);

  useEffect(() => {
    if (!financeLive || commissionPercentTouchedRef.current) return;
    setCommissionPercentStr(
      formatCommissionPercentValue(
        parseCommissionPercentString(financeLive.defaultCommissionPercent ?? "0"),
      ),
    );
  }, [financeLive]);

  useEffect(() => {
    const onSaved = (ev: Event) => {
      const data = (ev as CustomEvent<SerializedFinancial>).detail;
      if (!data) return;
      setFinanceLive(data);
      if (!dollarRateTouchedRef.current) {
        const raw = data.finalDollarRate?.replace(",", ".");
        const f = raw ? Number(raw) : NaN;
        if (Number.isFinite(f) && f > 0) setDollarRate(f.toFixed(4));
      }
      if (!commissionPercentTouchedRef.current) {
        setCommissionPercentStr(
          formatCommissionPercentValue(parseCommissionPercentString(data.defaultCommissionPercent ?? "0")),
        );
      }
    };
    window.addEventListener(WEGO_FINANCIAL_SETTINGS_SAVED, onSaved);
    return () => window.removeEventListener(WEGO_FINANCIAL_SETTINGS_SAVED, onSaved);
  }, []);

  useEffect(() => {
    currentSigRef.current = currentDraftSig;
    if (!baselineSigRef.current) baselineSigRef.current = currentDraftSig;
  }, [currentDraftSig]);

  const weekSelectValue = useMemo(() => {
    const w = weekReadonly !== "—" ? weekReadonly : DEFAULT_WEEK_CODE;
    return WORK_WEEK_RANGES[w] ? w : DEFAULT_WEEK_CODE;
  }, [weekReadonly]);

  /** שבוע AH לסינון יתרות בטבלה: שדה השבוע במסך (כולל עריכה), לא רק תאריך התשלום */
  const intakeWeekCode = useMemo(() => {
    const d = normalizeAhWeekCode(weekDraft.trim());
    if (d) return d;
    if (weekReadonly !== "—") {
      const wr = normalizeAhWeekCode(weekReadonly);
      return wr ?? weekReadonly;
    }
    return normalizeAhWeekCode(globalWeek) ?? DEFAULT_WEEK_CODE;
  }, [weekDraft, weekReadonly, globalWeek]);

  const intakeWeekTableHint = useMemo(() => {
    return "מציג את כל היסטוריית ההזמנות של הלקוח";
  }, []);

  const applyWeekNumber = useCallback(
    (num: number) => {
      const nextCode = toWeekCode(num);
      const diffWeeks = num - baseWeekNumber;
      const nextDate = addDays(baseDate, diffWeeks * 7);
      setPaymentDateYmd(formatLocalYmd(nextDate));
      setWeekDraft(nextCode);
    },
    [baseDate, baseWeekNumber],
  );

  useEffect(() => {
    const c = weekCodeFromYmd(paymentDateYmd);
    if (c && c !== "—") setWeekDraft(c);
  }, [paymentDateYmd]);

  const ordersCountryBadge = useMemo(() => countryBadgeFromOrders(orders), [orders]);

  const countryBadgeDisplay = useMemo(() => {
    if (countryOverride !== "AUTO") return COUNTRY_BADGE_SHORT[countryOverride];
    return ordersCountryBadge;
  }, [countryOverride, ordersCountryBadge]);

  /** סיכום כרטסת לקוח — יתרות פתוחות וזכות (מ-DB, חתום) */
  const customerLedgerSummary = useMemo(() => {
    let openTotal = 0;
    let creditTotal = 0;
    for (const row of matched) {
      const bal = orderLedgerBalanceUsd(row);
      if (bal > 0.01) openTotal += bal;
      else if (bal < -0.01) creditTotal += Math.abs(bal);
    }
    return {
      orderCount: matched.length,
      openTotal: roundMoney2(openTotal),
      creditTotal: roundMoney2(creditTotal),
    };
  }, [matched]);

  const customerBalanceUsd = useMemo(
    () => parseMoneyStringOrZero(customer?.customerBalanceUsd ?? "0"),
    [customer?.customerBalanceUsd],
  );
  const customerHasCredit = customerBalanceUsd > 0.01;
  /** מחשבון עסקי חי — חיובים / עמלות / תשלומים / יתרה (כולל תשלום בטופס + איפוס עמלה) */
  const liveIntakeTotals = useMemo(
    () =>
      computePaymentIntakeLiveTotals({
        orders: toPaymentIntakeBases(orders),
        commissionResetOrderIds: commissionResetIds,
        commissionResetPreview,
        customerBalanceResetPreview,
        customerPaymentsUsd: sumCustomerPaymentsUsd(customerPayments),
        formPaymentUsd: totals.totalUsd,
      }),
    [
      orders,
      commissionResetIds,
      commissionResetPreview,
      customerBalanceResetPreview,
      customerPayments,
      totals.totalUsd,
    ],
  );

  /** מחשבון חי — רק שורות התשלום בטופס (onChange) */
  const liveFormKpis = useMemo(
    () => aggregateLivePaymentFormKpis(payments, rateN),
    [payments, rateN],
  );

  /** חוב פתוח בטבלה (DB) + סכום עמלות על הזמנות פתוחות — לחלון אישור איפוס יתרה */
  const resetBalanceConfirm = useMemo(() => {
    let openDebtUsd = 0;
    let openCommissionUsd = 0;
    for (const o of orders) {
      const rem = Math.max(0, Number(o.totalAmountUsd) - Number(o.dbPaidUsd));
      if (rem <= 0.01) continue;
      openDebtUsd += rem;
      openCommissionUsd += Number(o.commissionUsd) || 0;
    }
    openDebtUsd = roundMoney2(openDebtUsd);
    openCommissionUsd = roundMoney2(openCommissionUsd);
    const afterCommissionUsd = roundMoney2(openCommissionUsd - openDebtUsd);
    return { openDebtUsd, openCommissionUsd, afterCommissionUsd };
  }, [orders]);

  const intakeStripOpenDebtUsd = customerBalanceResetPending
    ? 0
    : resetBalanceConfirm.openDebtUsd > 0.01
      ? resetBalanceConfirm.openDebtUsd
      : liveIntakeTotals.hasDebt
        ? liveIntakeTotals.balanceUsd
        : 0;

  const showIntakeStripOpenDebt =
    customerBalanceResetPending || intakeStripOpenDebtUsd > 0.01;

  const showResetBalanceBtn = useMemo(() => {
    if (!viewerIsAdmin || !customer) return false;
    return (
      resetBalanceConfirm.openDebtUsd > 0.01 ||
      liveIntakeTotals.balanceUsd > 0.01 ||
      liveIntakeTotals.hasDebt
    );
  }, [
    viewerIsAdmin,
    customer,
    resetBalanceConfirm.openDebtUsd,
    liveIntakeTotals.balanceUsd,
    liveIntakeTotals.hasDebt,
  ]);

  const canApplyResetCustomerBalance = resetBalanceConfirm.openDebtUsd > 0.01;

  const refreshPaymentCodePreview = useCallback(() => {
    setPaymentCodePreviewPending(true);
    void previewPaymentCodeForCaptureAction().then((pr) => {
      setPaymentCodePreviewPending(false);
      if (pr.ok) {
        setPreviewPaymentCode(pr.code);
        setSaveErr(null);
      } else {
        setPreviewPaymentCode(null);
        setSaveErr(pr.error);
      }
    });
  }, []);

  const focusCustomerCodeInput = useCallback(() => {
    const el = customerCodeInputRef.current;
    if (!el) return;
    el.focus();
  }, []);

  const focusFirstAmountInput = useCallback(() => {
    window.setTimeout(() => {
      const el = firstAmountInputRef.current;
      if (!el) return;
      el.focus();
      try {
        el.select();
      } catch {
        /* ignore */
      }
    }, 0);
  }, []);

  const focusSavePrimaryButton = useCallback(() => {
    window.setTimeout(() => {
      (savePrimaryButtonRef.current ?? saveAndNewButtonRef.current)?.focus();
    }, 0);
  }, []);

  const loadCustomerOrders = useCallback(
    async (customerId: string, opts?: { silent?: boolean; focusAmount?: boolean; weekCode?: string }): Promise<boolean> => {
      if (opts?.silent) setOrdersLoading(true);
      else setLoadingCustomer(true);
      setLoadErr(null);
      const res = await fetchPaymentIntakeCustomerOrdersAction(customerId, null);
      if (opts?.silent) setOrdersLoading(false);
      else setLoadingCustomer(false);
      if (!res.ok) {
        setCustomer(null);
        setCustomerPayments([]);
        setOrders([]);
        setCommissionResetIds([]);
        setCustomerBalanceResetPending(false);
        setLoadErr(res.error);
        return false;
      }
      setCustomer(res.customer);
      setCustomerPayments(res.customerPayments);
      setOrders(res.orders);
      setCommissionResetIds([]);
      setCustomerBalanceResetPending(false);
      setDraftCustomer({
        code: res.customer.customerCode ?? "",
        displayName: res.customer.displayName ?? "",
        nameEn: res.customer.nameEn ?? res.customer.nameHe ?? "",
        nameAr: res.customer.nameAr ?? "",
        phone: res.customer.phone ?? "",
        index: res.customer.customerIndex ?? "",
      });
      setIncludedIds(null);
      setSaveErr(null);
      setCustSearchNoHits(false);
      if (opts?.focusAmount === true) {
        focusFirstAmountInput();
      }
      return true;
    },
    [focusFirstAmountInput],
  );

  /** בחירת לקוח מיידית — פוקוס לסכום בלי להמתין לטעינת הזמנות */
  const selectCustomerQuick = useCallback(
    (row: CustomerSearchRow, opts?: { focusAmount?: boolean }) => {
      setOrders([]);
      setCustomerPayments([]);
      setCommissionResetIds([]);
      setCustomerBalanceResetPending(false);
      setCustomer({
        id: row.id,
        displayName: row.label,
        customerCode: row.code,
        nameEn: row.nameEn ?? null,
        nameHe: row.nameHe ?? null,
        nameAr: row.nameAr ?? null,
        phone: row.phone ?? null,
        customerIndex: row.oldCustomerCode ?? null,
        customerBalanceUsd: "0.00",
      });
      setDraftCustomer({
        code: row.code ?? "",
        displayName: row.label,
        nameEn: row.nameEn ?? row.nameHe ?? "",
        nameAr: row.nameAr ?? "",
        phone: row.phone ?? "",
        index: row.oldCustomerCode ?? "",
      });
      setIncludedIds(null);
      setSaveErr(null);
      setCustSearchNoHits(false);
      setCustomerHits([]);
      setCustDdOpen(false);
      setCustSearching(false);
      if (opts?.focusAmount !== false) {
        focusFirstAmountInput();
      }
      void loadCustomerOrders(row.id, { silent: true });
    },
    [loadCustomerOrders, focusFirstAmountInput],
  );

  const pickCustHit = useCallback(
    (row: CustomerSearchRow) => {
      custSearchGenRef.current += 1;
      selectCustomerQuick(row, { focusAmount: true });
    },
    [selectCustomerQuick],
  );

  const onDraftCustomerChange = useCallback((field: CustFieldKey, value: string) => {
    lastEditedFieldRef.current = field;
    setDraftCustomer((prev) => ({ ...prev, [field]: value }));
    setSearchTick((n) => n + 1);
    setCustDdOpen(field !== "phone");
  }, []);

  const triggerFieldSearch = useCallback((field: CustFieldKey) => {
    lastEditedFieldRef.current = field;
    setSearchTick((n) => n + 1);
    setCustDdOpen(true);
  }, []);

  /** פוקוס לקוד לקוח בפתיחה — פעם אחת; לא חוזר אחרי טעינת קוד תשלום ברקע */
  useLayoutEffect(() => {
    focusCustomerCodeInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only
  }, []);

  async function resolveCustomerFromFieldEnter(field: CustFieldKey = "code") {
    const q = draftCustomerRef.current[field].trim();
    if (!q) return;
    if (!customerSearchMinQueryLength(q, true)) {
      if (field === "code") onToast("הזן לפחות 2 תווים לחיפוש");
      return;
    }
    custSearchGenRef.current += 1;
    cancelCustomerSearch();
    lastEditedFieldRef.current = field;
    setCustomerCodeEnterBusy(true);
    setCustSearchNoHits(false);
    setLoadErr(null);
    try {
      const row = await resolveCustomerFastClient(q);
      if (row) {
        selectCustomerQuick(row, { focusAmount: true });
        return;
      }
      if (field === "code" && /^\d+$/.test(q)) {
        setCustomerHits([]);
        setCustDdOpen(false);
        setCustSearchNoHits(true);
        return;
      }
      const rows = await searchCustomersFastClient(q);
      const auto = pickAutoCustomerHit(rows, q);
      if (auto) {
        selectCustomerQuick(auto, { focusAmount: true });
        return;
      }
      if (rows.length === 0) {
        setCustomerHits([]);
        setCustDdOpen(false);
        setCustSearchNoHits(true);
        return;
      }
      setCustomerHits(rows);
      setCustDdOpen(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setLoadErr("בעיה בחיבור לשרת");
    } finally {
      setCustomerCodeEnterBusy(false);
    }
  }

  function syncBaselineSoon() {
    window.setTimeout(() => {
      baselineSigRef.current = currentSigRef.current;
    }, 0);
  }

  const clearCurrentPaymentState = useCallback(() => {
    custSearchGenRef.current += 1;
    setEditingBadge(null);
    setCountryOverride("AUTO");
    setCustomer(null);
    setOrders([]);
    setDraftCustomer({ ...EMPTY_CUSTOMER_DRAFT });
    setCustomerHits([]);
    setCustDdOpen(false);
    setIncludedIds(null);
    setCustSearchNoHits(false);
    setOrderEditId(null);
    setPayments([createDefaultLine()]);
    setDollarRate(parseFinalRate(financial).toFixed(4));
    setLoadErr(null);
    setSaveErr(null);
    setHighlightInvalidCheckFields(false);
    setLoadedPayment(createNewCaptureLoadedPayment(""));
    setPreviewPaymentCode(null);
    setPaymentCodePreviewPending(true);
    setPreviousPaymentId(null);
    setNextPaymentId(null);
    setCustomerBalanceResetPending(false);
    baselineSigRef.current = "";
    refreshPaymentCodePreview();
  }, [financial, refreshPaymentCodePreview]);

  function applyNavigationLinks(nav: PaymentEntryNavigation) {
    setPreviousPaymentId(nav.previousPaymentId);
    setNextPaymentId(nav.nextPaymentId);
    console.log("[payment-nav] currentPayment", {
      id: nav.currentPaymentId,
      code: nav.currentPaymentCode,
      number: nav.currentPaymentNumber,
    });
    console.log("[payment-nav] previousPayment", nav.previousPaymentId);
    console.log("[payment-nav] nextPayment", nav.nextPaymentId);
  }

  async function applyPaymentEntry(snapshot: PaymentEntryResponse): Promise<boolean> {
    custSearchGenRef.current += 1;
    const pageScrollY = window.scrollY;
    const tableScroll = tableScrollRef.current?.scrollTop ?? 0;
    const snap = clonePaymentEntry(snapshot);
    const snapshotWeek = normalizeAhWeekCode(weekCodeFromYmd(snap.paymentDateYmd)) ?? DEFAULT_WEEK_CODE;
    setPaymentDateYmd(snap.paymentDateYmd);
    setWeekDraft(snapshotWeek);
    const loaded = await loadCustomerOrders(snap.customer.id, { silent: true, weekCode: snapshotWeek });
    if (!loaded) {
      setSaveErr("טעינת הלקוח נכשלה");
      return false;
    }

    setLoadedPayment(snap);
    setPreviewPaymentCode(snap.paymentCode?.trim() || null);
    setPaymentCodePreviewPending(false);
    setPaymentTimeHm(snap.paymentTimeHm);
    if (snap.dollarRate?.trim()) { dollarRateTouchedRef.current = true; setDollarRate(snap.dollarRate.trim()); }
    setCommissionPercentStr(snap.commissionPercent?.trim() ? snap.commissionPercent.trim() : systemCommissionPercentStr);
    setPayments(
      snap.lines.length > 0
        ? snap.lines.map((l) => ({
            ...l,
            checks: l.checks?.map((ch) => ({ ...ch })),
          }))
        : [createDefaultLine()],
    );
    setIncludedIds(null);

    window.setTimeout(() => {
      window.scrollTo({ top: pageScrollY });
      if (tableScrollRef.current) tableScrollRef.current.scrollTop = tableScroll;
      syncBaselineSoon();
    }, 0);
    return true;
  }

  /** טעינת קליטה שמורה + שכנות ניווט מהשרת — מרענן את כל המסך */
  async function loadPayment(paymentId: string): Promise<boolean> {
    const trimmed = paymentId.trim();
    if (!trimmed) return false;

    setPaymentNavLoading(true);
    setSaveErr(null);
    setLoadErr(null);

    try {
      const res = await fetch(`/api/payments/entry?id=${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setSaveErr("לא ניתן לטעון קליטת תשלום");
        return false;
      }

      const raw = (await res.json()) as PaymentEntryLoadResponse;
      const { navigation, ...entryFields } = raw;
      const entry = clonePaymentEntry(entryFields);

      setCommissionResetIds([]);
      setCustomerBalanceResetPending(false);
      setIncludedIds(null);
      baselineSigRef.current = "";

      const ok = await applyPaymentEntry(entry);
      if (!ok) return false;

      applyNavigationLinks(navigation);
      return true;
    } catch {
      setSaveErr("שגיאת רשת בטעינת תשלום");
      return false;
    } finally {
      setPaymentNavLoading(false);
    }
  }

  function paymentCaptureIsDirty(): boolean {
    return baselineSigRef.current !== "" && baselineSigRef.current !== currentDraftSig;
  }

  function goToPreviousPayment() {
    if (!previousPaymentId || paymentNavLoading || saveBusy) return;
    if (paymentCaptureIsDirty()) {
      setNavUnsavedOpen("prev");
      return;
    }
    void loadPayment(previousPaymentId);
  }

  function goToNextPayment() {
    if (!nextPaymentId || paymentNavLoading || saveBusy) return;
    if (paymentCaptureIsDirty()) {
      setNavUnsavedOpen("next");
      return;
    }
    void loadPayment(nextPaymentId);
  }

  function confirmNavUnsavedAndProceed() {
    const direction = navUnsavedOpen;
    if (!direction) return;
    setNavUnsavedOpen(null);
    const targetId = direction === "prev" ? previousPaymentId : nextPaymentId;
    if (!targetId) return;
    void loadPayment(targetId);
  }

  useEffect(() => {
    if (initialAppliedRef.current) return;
    initialAppliedRef.current = true;
    const init = initialPayment ?? {};
    void (async () => {
      const pid = init.paymentId?.trim();
      if (pid) {
        setPaymentCodePreviewPending(false);
        await loadPayment(pid);
        return;
      }

      refreshPaymentCodePreview();

      const onum = init.orderNumber?.trim();
      const cid = init.customerId?.trim();
      if (onum) {
        const ctx = await fetchOrderForPaymentContextAction(onum);
        if (ctx.ok && ctx.data.customerId) {
          await loadCustomerOrders(ctx.data.customerId);
          const rem = Number(ctx.data.remainingUsd.replace(",", "."));
          const empty = payments.length === 1 && payments[0] && payments[0].amount === "";
          if (Number.isFinite(rem) && rem > 0.01 && empty) {
            setPayments([
              {
                ...createDefaultLine(),
                usdAmount: rem,
                usdPaymentMethod: "CASH",
                usdNote: `סגירת חיוב הזמנה ${onum}`,
              },
            ]);
          }
        }
      } else if (cid) {
        await loadCustomerOrders(cid);
      } else if (init.customerName?.trim()) {
        lastEditedFieldRef.current = "displayName";
        setDraftCustomer((p) => ({ ...p, displayName: init.customerName!.trim() }));
        setSearchTick((n) => n + 1);
        setCustDdOpen(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayment, loadCustomerOrders]);

  useEffect(() => {
    if (resetOnKey === undefined) return;
    initialAppliedRef.current = false;
    custSearchGenRef.current += 1;
    setEditingBadge(null);
    setCountryOverride("AUTO");
    setCustomer(null);
    setOrders([]);
    setDraftCustomer({ ...EMPTY_CUSTOMER_DRAFT });
    setCustomerHits([]);
    setCustDdOpen(false);
    setIncludedIds(null);
    setCustSearchNoHits(false);
    setOrderEditId(null);
    setPayments([createDefaultLine()]);
    dollarRateTouchedRef.current = false;
    setDollarRate(parseFinalRate(financial).toFixed(4));
    setPaymentDateYmd(formatLocalYmd(new Date()));
    setPaymentTimeHm(formatLocalHm(new Date()));
    setSaveErr(null);
    setPaymentNavLoading(false);
    setNavUnsavedOpen(null);
    setPreviousPaymentId(null);
    setNextPaymentId(null);
    setCustomerBalanceResetPending(false);
    setPreviewPaymentCode(null);
    setLoadedPayment(createNewCaptureLoadedPayment(""));
    refreshPaymentCodePreview();
    syncBaselineSoon();
    window.setTimeout(() => focusCustomerCodeInput(), 0);
  }, [resetOnKey, financial, refreshPaymentCodePreview, focusCustomerCodeInput]);

  useEffect(() => {
    let cancelled = false;
    const gen = ++custSearchGenRef.current;
    const abort = new AbortController();

    const t = window.setTimeout(() => {
      void (async () => {
        if (cancelled || gen !== custSearchGenRef.current) return;
        const field = lastEditedFieldRef.current;
        const q = draftCustomerRef.current[field].trim();

        const allEmpty = (Object.keys(EMPTY_CUSTOMER_DRAFT) as CustFieldKey[]).every(
          (k) => !draftCustomerRef.current[k].trim(),
        );

        if (!q) {
          if (!cancelled && gen === custSearchGenRef.current) {
            setCustomerHits([]);
            setCustDdOpen(false);
            setCustSearchNoHits(false);
            setCustSearching(false);
            if (allEmpty) {
              setCustomer(null);
              setOrders([]);
              setLoadErr(null);
            }
          }
          return;
        }
        if (!customerSearchMinQueryLength(q)) {
          setCustomerHits([]);
          setCustDdOpen(false);
          setCustSearchNoHits(false);
          setCustSearching(false);
          return;
        }

        setCustSearching(true);
        setCustSearchField(field);
        setCustSearchNoHits(false);
        try {
          const rows =
            field === "code" && /^\d+$/.test(q)
              ? await searchCustomerCodeExactClient(q, { signal: abort.signal })
              : await searchCustomersFastClient(q, { signal: abort.signal });
          if (cancelled || gen !== custSearchGenRef.current) return;

          const still = draftCustomerRef.current[lastEditedFieldRef.current].trim() === q;
          if (!still) return;

          const auto = pickAutoCustomerHit(rows, q);
          if (auto) {
            selectCustomerQuick(auto, { focusAmount: false });
            return;
          }

          setCustSearchNoHits(rows.length === 0);
          setCustomerHits(rows);
          setCustDdOpen(rows.length > 0 && field !== "phone");
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          if (!cancelled && gen === custSearchGenRef.current) {
            setCustomerHits([]);
            setCustSearchNoHits(false);
            setLoadErr("בעיה בחיבור לשרת");
          }
        } finally {
          if (!cancelled && gen === custSearchGenRef.current) {
            setCustSearching(false);
            setCustSearchField(null);
          }
        }
      })();
    }, CUSTOMER_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      abort.abort();
      window.clearTimeout(t);
    };
  }, [searchTick, selectCustomerQuick]);

  useEffect(() => () => cancelCustomerSearch(), []);

  function toggleRow(id: string) {
    setIncludedIds((prev) => {
      const set = new Set(prev ?? []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      const arr = [...set];
      return arr.length > 0 ? arr : null;
    });
  }

  function rowChecked(id: string): boolean {
    if (includedIds === null) return false;
    return includedIds.includes(id);
  }

  function addPaymentLine(preset?: Partial<PaymentLine>) {
    // newest first — תשלום חדש מופיע ראשון, ישנים נדחפים למטה.
    setPayments((cur) => [{ ...createDefaultLine(), ...preset, id: newLineId() }, ...cur]);
  }

  function removePaymentLine(id: string) {
    setPayments((cur) => cur.filter((x) => x.id !== id));
  }

  function updatePaymentLine(id: string, patch: Partial<PaymentLine>) {
    setHighlightInvalidCheckFields(false);
    setPayments((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function updatePaymentLineCheck(lineId: string, checkId: string, patch: Partial<PaymentLineCheck>) {
    setHighlightInvalidCheckFields(false);
    setPayments((cur) =>
      cur.map((line) => {
        if (line.id !== lineId) return line;
        const checks = [...(line.checks ?? [])];
        const ix = checks.findIndex((c) => c.id === checkId);
        if (ix < 0) return line;
        checks[ix] = { ...checks[ix]!, ...patch };
        return { ...line, checks };
      }),
    );
  }

  function addPaymentLineCheck(lineId: string) {
    setHighlightInvalidCheckFields(false);
    setPayments((cur) =>
      cur.map((line) => {
        if (line.id !== lineId) return line;
        const checks = [...(line.checks ?? []), emptyCheckRow()];
        return { ...line, checks };
      }),
    );
  }

  function removePaymentLineCheck(lineId: string, checkId: string) {
    setHighlightInvalidCheckFields(false);
    setPayments((cur) =>
      cur.map((line) => {
        if (line.id !== lineId) return line;
        const checks = (line.checks ?? []).filter((c) => c.id !== checkId);
        if (checks.length === 0) return { ...line, checks: [emptyCheckRow()] };
        return { ...line, checks };
      }),
    );
  }

  function addLineFromOrder(row: PaymentIntakeMatchResult) {
    const remUsd = roundMoney2(Math.max(0, orderRowLedgerBalance(row)));
    if (remUsd <= 0.01) return;
    const onum = row.orderNumber ?? row.id.slice(0, 8);
    addPaymentLine({
      usdAmount: remUsd,
      usdPaymentMethod: "CASH",
      usdNote: `סגירת חיוב הזמנה ${onum}`,
    });
    onToast("נוסף תשלום מסגירת חיוב (ללא שמירה)");
  }

  /**
   * Helper פנימי: ביצוע השמירה בלבד (validations + server action).
   * מחזיר true אם השמירה הצליחה.
   * אין כאן side-effects של reset/reload — את זה מנהלים `onSaveAndNew` / `onSaveAndClose`.
   */
  async function performSave(
    saveSurplusAsCredit = false,
  ): Promise<{ ok: true; primaryPaymentCode: string; customerBalanceUsd: string } | { ok: false }> {
    setSaveErr(null);
    setHighlightInvalidCheckFields(false);
    if (!customer) {
      setSaveErr("יש לבחור לקוח");
      return { ok: false };
    }
    if (totals.totalUsd <= 0) {
      setSaveErr("יש להוסיף סכום בדולר ו/או בשקל (נדרש שער דולר להמרת שקל)");
      return { ok: false };
    }
    if (rateN <= 0) {
      setSaveErr("שער דולר חיובי");
      return { ok: false };
    }
    const checkErr = validatePaymentCheckLines(payments);
    if (checkErr) {
      setSaveErr(checkErr);
      setHighlightInvalidCheckFields(true);
      return { ok: false };
    }
    const forceCustomerCreditPayment = customerHasCredit;
    const { byOrderId, unallocatedUsd } =
      forceCustomerCreditPayment && totals.totalUsd > 0.02
        ? { byOrderId: new Map<string, number>(), unallocatedUsd: totals.totalUsd }
        : allocatePaymentAcrossOrders(bases, totals.totalUsd, prioritizedSet);
    const hasAlloc = [...byOrderId.values()].some((v) => v > 0.02);
    if (!hasAlloc && !((saveSurplusAsCredit || forceCustomerCreditPayment) && unallocatedUsd > 0.02)) {
      setSaveErr("אין יעד להקצאה");
      return { ok: false };
    }
    if (totals.totalUsd > 0.02 && unallocatedUsd > 0.02 && !saveSurplusAsCredit && !forceCustomerCreditPayment) {
      const prev = await previewCustomerPaymentOverageAction({
        customerId: customer.id,
        totalPaymentUsd: totals.totalUsd,
        dollarRate,
        weekCode: intakeWeekCode,
      });
      if (prev.ok && prev.preview.hasOverage) {
        setOveragePreview(prev.preview);
        setOverageModalOpen(true);
        return { ok: false };
      }
    }
    setSaveBusy(true);
    const receivedTodaySave = isTodayYmd(paymentDateYmd);
    const hm = (paymentTimeHm || "").trim() || formatLocalHm(new Date());
    const weekForSave = intakeWeekCode;
    const res = await savePaymentUpdatedAction({
      customerId: customer.id,
      receivedToday: receivedTodaySave,
      paymentDateYmd: receivedTodaySave ? formatLocalYmd(new Date()) : paymentDateYmd,
      paymentTimeHm: hm,
      weekCode: weekForSave,
      dollarRate,
      commissionPercent: commissionPercentStr,
      payments,
      includedOrderIds: forceCustomerCreditPayment ? [] : includedIds,
      commissionResetOrderIds: commissionResetIds.length > 0 ? commissionResetIds : null,
      applyCustomerBalanceReset: customerBalanceResetPending,
      draftNameAr: draftCustomer.nameAr.trim() || null,
      draftNameEn: draftCustomer.nameEn.trim() || null,
      draftPhone: draftCustomer.phone.trim() || null,
      saveSurplusAsCredit: saveSurplusAsCredit || forceCustomerCreditPayment,
    });
    setSaveBusy(false);
    if (!res.ok) {
      setSaveErr(res.error);
      return { ok: false };
    }
    const primaryPaymentCode = res.saved.primaryPaymentCode?.trim() ?? "";
    const remainingAfter = roundMoney2(
      matched.reduce((sum, row) => sum + Math.max(0, row.remainingAmount), 0),
    );
    setCustomer((cur) => (cur ? { ...cur, customerBalanceUsd: res.saved.customerBalanceUsd } : cur));
    if ((saveSurplusAsCredit || forceCustomerCreditPayment) && unallocatedUsd > 0.02) {
      onToast(`נשמרה יתרת זכות של ${unallocatedUsd.toFixed(2)}$ ללקוח`);
    } else if (Number(res.saved.customerBalanceUsd) > 0.01) {
      onToast(`יתרת זכות לאחר שמירה: ${Number(res.saved.customerBalanceUsd).toFixed(2)}$`);
    } else if (remainingAfter <= 0.01) onToast("כל החיובים נסגרו בהצלחה");
    else onToast(`נשארו ${remainingAfter.toFixed(2)}$ פתוחים`);
    if (customerBalanceResetPending) {
      setCustomerBalanceResetPending(false);
      onToast("איפוס יתרה בוצע עם שמירת התשלום");
    }
    if (!primaryPaymentCode) {
      setSaveErr("שמירה הצליחה אך חסר קוד תשלום");
      return { ok: false };
    }
    // Signal the balances report to re-fetch (if it's open behind this modal)
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("wego:balances-refresh"));
    }
    return { ok: true, primaryPaymentCode, customerBalanceUsd: res.saved.customerBalanceUsd };
  }

  function finishSaveAndNewOptimistic(savedCode: string) {
    const cid = customer?.id;
    if (!cid) return;
    setPayments([createDefaultLine()]);
    setPaymentTimeHm(formatLocalHm(new Date()));
    setIncludedIds(null);
    setCustomerBalanceResetPending(false);
    setCommissionResetIds([]);
    setSaveErr(null);
    setLoadedPayment(createNewCaptureLoadedPayment(savedCode));
    setPreviousPaymentId(null);
    setNextPaymentId(null);
    syncBaselineSoon();
    focusFirstAmountInput();
    void loadCustomerOrders(cid, { silent: true });
    refreshPaymentCodePreview();
  }

  async function finishSaveAndNew(savedCode: string) {
    finishSaveAndNewOptimistic(savedCode);
  }

  /**
   * "שמור וחדש" — שומר את התשלום הנוכחי, מאפס את הטופס,
   * וטוען מחדש את ההזמנות של הלקוח כדי שיתרת ההזמנות תתעדכן —
   * אך המודאל נשאר פתוח, מוכן לתשלום חדש.
   */
  async function onSaveAndNew() {
    saveAfterOverageRef.current = "new";
    const res = await performSave(false);
    if (!res.ok) return;
    saveAfterOverageRef.current = null;
    await finishSaveAndNew(res.primaryPaymentCode);
  }

  /**
   * "שמור תשלום" — שומר את התשלום וסוגר את המודאל.
   * זהו ה־flow הסופי / רגיל.
   */
  async function onSaveAndClose() {
    saveAfterOverageRef.current = "close";
    const res = await performSave(false);
    if (!res.ok) return;
    saveAfterOverageRef.current = null;
    closeTop();
  }

  async function onOverageConfirm() {
    setOverageModalOpen(false);
    const mode = saveAfterOverageRef.current;
    const res = await performSave(true);
    if (!res.ok) return;
    saveAfterOverageRef.current = null;
    if (mode === "new") await finishSaveAndNew(res.primaryPaymentCode);
    else if (mode === "close") closeTop();
  }

  function onOverageCancel() {
    setOverageModalOpen(false);
    saveAfterOverageRef.current = null;
    setOveragePreview(null);
  }

  function openCustomerLedger() {
    if (!customer || !canViewCustomerCard) return;
    openWindow({
      type: "customerCard",
      props: { customerId: customer.id, customerName: customer.displayName, initialTab: "ledger" },
    });
  }

  function openOrderForEdit(orderId: string) {
    if (!canEditOrders) {
      onToast("אין הרשאת עריכת הזמנה");
      return;
    }
    setOrderEditId(orderId);
  }

  function ledgerStatusClass(status: PaymentLedgerStatus): string {
    if (status === "open") return "pm-st--open";
    if (status === "credit") return "pm-st--credit";
    return "pm-st--paid";
  }

  function displayedLedgerStatus(balanceUsd: number): PaymentLedgerStatus {
    if (customerHasCredit && balanceUsd > 0.01) return "paid";
    return paymentLedgerStatus(balanceUsd);
  }

  function displayedLedgerStatusLabel(balanceUsd: number): string {
    if (customerHasCredit && balanceUsd > 0.01) return "מכוסה ביתרת זכות";
    return paymentLedgerStatusLabel(paymentLedgerStatus(balanceUsd));
  }

  function ledgerRowClass(status: PaymentLedgerStatus): string {
    if (status === "open") return "payment-modal-tr--status-open";
    if (status === "credit") return "payment-modal-tr--status-credit";
    return "payment-modal-tr--status-paid";
  }

  function orderRowLedgerBalance(row: PaymentIntakeMatchResult): number {
    return orderLedgerBalanceUsd(row);
  }

  function canCloseDebtForRow(row: PaymentIntakeMatchResult): boolean {
    if (customerHasCredit) return false;
    return orderRowLedgerBalance(row) > 0.01;
  }

  async function openPaymentHistory(orderId: string) {
    setPaymentHistoryOrderId(orderId);
    setPaymentHistoryRows([]);
    setPaymentHistoryErr(null);
    setPaymentHistoryBusy(true);
    const res = await fetchOrderPaymentHistoryAction(orderId);
    setPaymentHistoryBusy(false);
    if (!res.ok) {
      setPaymentHistoryErr(res.error);
      return;
    }
    setPaymentHistoryRows(res.rows);
  }

  function closePaymentHistory() {
    setPaymentHistoryOrderId(null);
    setPaymentHistoryRows([]);
    setPaymentHistoryErr(null);
  }

  const paymentCaptureNavLabel = displayedPaymentCode;
  const paymentIsCancelled = loadedPayment?.status === "CANCELLED";
  const canCancelSavedPayment = Boolean(savedCapturePaymentId) && !paymentIsCancelled;
  const canNavigateSavedPayments = Boolean(savedCapturePaymentId);
  const prevPaymentNavDisabled =
    saveBusy || paymentNavLoading || !canNavigateSavedPayments || !previousPaymentId;
  const nextPaymentNavDisabled =
    saveBusy || paymentNavLoading || !canNavigateSavedPayments || !nextPaymentId;

  async function executeCancelPayment() {
    if (!savedCapturePaymentId || cancelPaymentBusy) return;
    setCancelPaymentBusy(true);
    setSaveErr(null);
    try {
      const res = await cancelPaymentAction({
        paymentId: savedCapturePaymentId,
        reason: cancelReasonDraft.trim() || null,
      });
      if (!res.ok) {
        setSaveErr(res.error);
        onToast(res.error);
        return;
      }
      setCancelPaymentOpen(false);
      setCancelReasonDraft("");
      onToast(`תשלום ${res.paymentCode ?? ""} בוטל — היתרה עודכנה`);
      await loadPayment(savedCapturePaymentId);
      if (customer?.id) {
        await loadCustomerOrders(customer.id, { silent: true });
      }
      router.refresh();
    } finally {
      setCancelPaymentBusy(false);
    }
  }

  function badgeKeyFinish(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  return (
    <>
      <div className="payment-modal">
        <div className="payment-modal-split payment-layout">
          <div className="payment-modal-main payment-table" dir="rtl">
            <div className="payment-modal-rate-strip" dir="rtl">
              <span className="payment-modal-rate-strip-lead">שער דולר:</span>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                className="payment-modal-rate-strip-inp"
                value={dollarRate}
                onChange={(e) => { dollarRateTouchedRef.current = true; setDollarRate(sanitizeMoneyInput(e.target.value)); }}
                aria-label="שער דולר"
              />
              <span className="payment-modal-rate-strip-lead payment-modal-rate-strip-lead--pct">
                אחוז עמלה:
              </span>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                className="payment-modal-rate-strip-inp payment-modal-rate-strip-inp--pct"
                aria-label="אחוז עמלה"
                title={`ברירת מחדל מערכת: ${systemCommissionPercentStr}%`}
                value={commissionPercentStr}
                onChange={(e) => {
                  commissionPercentTouchedRef.current = true;
                  setCommissionPercentStr(sanitizePercentInput(e.target.value));
                }}
              />
            </div>
            {loadingCustomer ? <p className="payment-modal-hint payment-modal-hint--top">טוען…</p> : null}
            {loadErr ? <div className="payment-modal-err payment-modal-err--top">{loadErr}</div> : null}

            <div className="payment-modal-main-head">
              <div
                className="payment-modal-cust-toolbar"
                tabIndex={-1}
                onBlurCapture={(e) => {
                  const next = e.relatedTarget as Node | null;
                  if (next && e.currentTarget.contains(next)) return;
                  window.setTimeout(() => setCustDdOpen(false), 200);
                }}
              >
                <div className="payment-modal-cust-inputs" dir="rtl">
                  <label className="payment-modal-cust-inp-wrap">
                    <span className="payment-modal-cust-inp-lbl payment-modal-cust-inp-lbl--row">
                      <span>קוד לקוח</span>
                      <button
                        type="button"
                        className="payment-modal-cust-lupe"
                        aria-label="חיפוש לפי קוד לקוח"
                        onClick={() => triggerFieldSearch("code")}
                      >
                        🔍
                      </button>
                    </span>
                    <div className="payment-modal-cust-code-field">
                      <input
                        ref={customerCodeInputRef}
                        type="text"
                        autoComplete="off"
                        className={`payment-modal-cust-inp payment-modal-cust-inp--code${customerCodeEnterBusy || custSearching ? " payment-modal-cust-inp--code-busy" : ""}`}
                        dir="ltr"
                        value={draftCustomer.code}
                        onChange={(e) => onDraftCustomerChange("code", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void resolveCustomerFromFieldEnter("code");
                          }
                        }}
                      />
                      {customerCodeEnterBusy || (custSearching && custSearchField === "code") ? (
                        <span className="payment-modal-cust-code-busy-spin" aria-hidden>
                          <span className="payment-modal-save-spinner" />
                        </span>
                      ) : null}
                    </div>
                  </label>
                  <label className="payment-modal-cust-inp-wrap">
                    <span className="payment-modal-cust-inp-lbl payment-modal-cust-inp-lbl--row">
                      <span>שם לקוח</span>
                      <button
                        type="button"
                        className="payment-modal-cust-lupe"
                        aria-label="חיפוש לפי שם לקוח"
                        onClick={() => triggerFieldSearch("displayName")}
                      >
                        🔍
                      </button>
                    </span>
                    <input
                      type="text"
                      autoComplete="off"
                      className="payment-modal-cust-inp payment-modal-cust-inp--name"
                      value={draftCustomer.displayName}
                      onChange={(e) => onDraftCustomerChange("displayName", e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void resolveCustomerFromFieldEnter("displayName");
                        }
                      }}
                    />
                  </label>
                  <label className="payment-modal-cust-inp-wrap">
                    <span className="payment-modal-cust-inp-lbl">שם באנגלית</span>
                    <input
                      type="text"
                      autoComplete="off"
                      className="payment-modal-cust-inp"
                      dir="ltr"
                      placeholder="Enter English name"
                      value={draftCustomer.nameEn}
                      onChange={(e) => onDraftCustomerChange("nameEn", e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void resolveCustomerFromFieldEnter("nameEn");
                        }
                      }}
                    />
                  </label>
                  <label className="payment-modal-cust-inp-wrap">
                    <span className="payment-modal-cust-inp-lbl payment-modal-cust-inp-lbl--row">
                      <span>שם בערבית</span>
                      <button
                        type="button"
                        className="payment-modal-cust-lupe"
                        aria-label="חיפוש לפי שם בערבית"
                        onClick={() => triggerFieldSearch("nameAr")}
                      >
                        🔍
                      </button>
                    </span>
                    <input
                      type="text"
                      autoComplete="off"
                      className="payment-modal-cust-inp"
                      dir="rtl"
                      placeholder="הזן שם בערבית"
                      value={draftCustomer.nameAr}
                      onChange={(e) => onDraftCustomerChange("nameAr", e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void resolveCustomerFromFieldEnter("nameAr");
                        }
                      }}
                    />
                  </label>
                <label className="payment-modal-cust-inp-wrap">
                  <span className="payment-modal-cust-inp-lbl">טלפון</span>
                  <input
                    type="text"
                    autoComplete="off"
                    className="payment-modal-cust-inp"
                    dir="ltr"
                    placeholder="הוסף טלפון אם חסר"
                    value={draftCustomer.phone}
                    onChange={(e) => onDraftCustomerChange("phone", e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void resolveCustomerFromFieldEnter("phone");
                      }
                    }}
                  />
                </label>
                  <label className="payment-modal-cust-inp-wrap">
                    <span className="payment-modal-cust-inp-lbl payment-modal-cust-inp-lbl--row">
                      <span>אינדקס</span>
                      <button
                        type="button"
                        className="payment-modal-cust-lupe"
                        aria-label="חיפוש לפי אינדקס"
                        onClick={() => triggerFieldSearch("index")}
                      >
                        🔍
                      </button>
                    </span>
                    <input
                      type="text"
                      autoComplete="off"
                      className="payment-modal-cust-inp"
                      dir="ltr"
                      value={draftCustomer.index}
                      onChange={(e) => onDraftCustomerChange("index", e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void resolveCustomerFromFieldEnter("index");
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="payment-modal-ledger-btn"
                    disabled={!customer || !canViewCustomerCard}
                    onClick={openCustomerLedger}
                    title="כרטסת לקוח"
                    aria-label="כרטסת לקוח"
                  >
                    📊
                  </button>
                </div>
                {custDdOpen && customerHits.length > 0 ? (
                  <ul className="payment-modal-dd payment-modal-dd--custstrip" role="listbox">
                    {customerHits.map((row) => (
                      <li key={row.id}>
                        <button type="button" className="payment-modal-dd-item" onMouseDown={() => void pickCustHit(row)}>
                          <span>{row.label}</span>
                          <span className="payment-modal-dd-meta" dir="ltr">
                            {row.code ?? row.id.slice(0, 8)}
                            {row.phone ? ` · ${row.phone}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {custSearchNoHits && !loadingCustomer && !custSearching ? (
                  <p className="payment-modal-cust-notfound" role="status">
                    לקוח לא נמצא
                  </p>
                ) : null}
                {customer ? (
                  <div className="payment-modal-cust-summary" role="status" aria-live="polite">
                    <span className="payment-modal-cust-name">{customer.displayName}</span>
                    <span className="payment-modal-cust-ids" dir="ltr">
                      {customer.customerCode ? `#${customer.customerCode}` : null}
                      {loadingCustomer || ordersLoading ? (
                        <span className="payment-modal-cust-summary-loading"> · טוען…</span>
                      ) : (
                        <>
                          {" · "}
                          {customerLedgerSummary.orderCount} הזמנות
                          {customerLedgerSummary.openTotal > 0.01 ? (
                            <>
                              {" · "}
                              <button
                                type="button"
                                className="payment-modal-cust-open-debt-link"
                                onClick={() => setOpenDebtDetailOpen(true)}
                              >
                                חוב פתוח: ${fmtUsdDisplay(customerLedgerSummary.openTotal)}
                              </button>
                            </>
                          ) : null}
                        </>
                      )}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="payment-modal-meta-fields" dir="rtl" aria-label="תאריך ושעה">
                {editingBadge === "time" ? (
                  <input
                    type="time"
                    className="payment-modal-inline-input"
                    dir="ltr"
                    autoFocus
                    value={paymentTimeHm}
                    onChange={(e) => setPaymentTimeHm(e.target.value)}
                    onBlur={() => setEditingBadge(null)}
                    onKeyDown={badgeKeyFinish}
                    aria-label="שעה"
                  />
                ) : (
                  <button type="button" className="payment-modal-inline-static" onClick={() => setEditingBadge("time")} aria-label="שעה — עריכה">
                    <span dir="ltr">{paymentTimeHm?.trim() ? paymentTimeHm : "—"}</span>
                  </button>
                )}

                {editingBadge === "date" ? (
                  <input
                    type="date"
                    className="payment-modal-inline-input"
                    dir="ltr"
                    autoFocus
                    value={paymentDateYmd}
                    onChange={(e) => setPaymentDateYmd(e.target.value)}
                    onBlur={() => setEditingBadge(null)}
                    onKeyDown={badgeKeyFinish}
                    aria-label="תאריך"
                  />
                ) : (
                  <button type="button" className="payment-modal-inline-static" onClick={() => setEditingBadge("date")} aria-label="תאריך — עריכה">
                    <span dir="ltr">{formatSlashDate(paymentDateYmd)}</span>
                  </button>
                )}

                {editingBadge === "country" ? (
                  <select
                    className="payment-modal-inline-input"
                    autoFocus
                    value={countryOverride}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "AUTO") setCountryOverride("AUTO");
                      else setCountryOverride(v as OrderCountryCode);
                    }}
                    onBlur={() => setEditingBadge(null)}
                    onKeyDown={badgeKeyFinish}
                    aria-label="מדינה"
                  >
                    <option value="AUTO">לפי הזמנות</option>
                    <option value="TURKEY">טורקיה</option>
                    <option value="CHINA">סין</option>
                    <option value="UAE">אמירויות</option>
                  </select>
                ) : (
                  <button type="button" className="payment-modal-inline-static" onClick={() => setEditingBadge("country")} aria-label="מדינה — עריכה">
                    {countryBadgeDisplay}
                  </button>
                )}

                <div className="payment-modal-week-row" dir="ltr" aria-label="שבוע עבודה">
                  <AhWeekNavPrevButton
                    className="payment-modal-week-arrow"
                    variant="angle"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const cur = parseWeekNumber(weekDraft) ?? parseWeekNumber(weekSelectValue) ?? baseWeekNumber;
                      applyWeekNumber(goToPrevWeekNumber(cur));
                      setWeekInputErr(null);
                    }}
                  />
                  <input
                    type="text"
                    className={weekInputErr ? "payment-modal-week-inp payment-modal-week-inp--err" : "payment-modal-week-inp"}
                    value={weekDraft}
                    list="pm-week-list-upd"
                    dir="ltr"
                    title={weekInputErr || undefined}
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
                      const curRaw = weekDraft.trim().toUpperCase();
                      const num = parseWeekNumber(curRaw);
                      if (num == null) {
                        setWeekInputErr(null);
                      setWeekDraft(weekReadonly !== "—" ? weekReadonly : globalWeek);
                        return;
                      }
                      setWeekDraft(toWeekCode(num));
                    }}
                  />
                  <AhWeekNavNextButton
                    className="payment-modal-week-arrow"
                    variant="angle"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const cur = parseWeekNumber(weekDraft) ?? parseWeekNumber(weekSelectValue) ?? baseWeekNumber;
                      applyWeekNumber(goToNextWeekNumber(cur));
                      setWeekInputErr(null);
                    }}
                  />
                  <button
                    type="button"
                    className="payment-modal-week-dd"
                    aria-label="רשימת שבועות"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const el = document.querySelector<HTMLInputElement>(".payment-modal-week-inp");
                      el?.focus();
                    }}
                  >
                    ▼
                  </button>
                  <datalist id="pm-week-list-upd">
                    {WORK_WEEK_CODES_SORTED.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>

              </div>
            </div>

            <div className="payment-modal-table-wrap">
              {customer && intakeWeekTableHint ? (
                <p className="payment-modal-intake-week-hint" dir="rtl">
                  {intakeWeekTableHint}
                </p>
              ) : null}
              {customer ? (
                <div className="payment-modal-summary-row payment-modal-summary-row--top" dir="rtl">
                  <PaymentLiveSummaryCards
                    kpis={liveFormKpis}
                    openDebtUsd={customerLedgerSummary.openTotal}
                    onOpenDebtClick={() => setOpenDebtDetailOpen(true)}
                  />
                </div>
              ) : null}
              {customer ? (
                <div
                  className="pm-intake-head-totals pm-intake-head-totals--live"
                  dir="rtl"
                  role="status"
                  aria-live="polite"
                  aria-label="מחשבון לקוח"
                >
                  <span className="pm-intake-head-totals__item">
                    <span className="pm-intake-head-totals__k">חיובים:</span>
                    <strong className="pm-intake-head-totals__v pm-intake-head-totals__v--charge" dir="ltr">
                      {fmtUsdDisplay(liveIntakeTotals.chargesUsd)}
                    </strong>
                  </span>
                  <span className="pm-intake-head-totals__sep" aria-hidden>
                    ·
                  </span>
                  <span className="pm-intake-head-totals__item">
                    <span className="pm-intake-head-totals__k">עמלות:</span>
                    <strong
                      className={[
                        "pm-intake-head-totals__v",
                        "pm-intake-head-totals__v--commission",
                        liveIntakeTotals.commissionsUsd < -0.01 ? "pm-intake-head-totals__v--commission-neg" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      dir="ltr"
                    >
                      {liveIntakeTotals.commissionsUsd < -0.01
                        ? `${fmtUsdDisplay(Math.abs(liveIntakeTotals.commissionsUsd))}-`
                        : fmtUsdDisplay(liveIntakeTotals.commissionsUsd)}
                    </strong>
                  </span>
                  <span className="pm-intake-head-totals__sep" aria-hidden>
                    ·
                  </span>
                  <span className="pm-intake-head-totals__item">
                    <span className="pm-intake-head-totals__k">תשלומים:</span>
                    <strong className="pm-intake-head-totals__v pm-intake-head-totals__v--payments" dir="ltr">
                      {fmtUsdDisplay(liveIntakeTotals.paymentsUsd)}
                    </strong>
                  </span>
                  {showIntakeStripOpenDebt ? (
                    <>
                      <span className="pm-intake-head-totals__sep" aria-hidden>
                        ·
                      </span>
                      <span className="pm-intake-head-totals__item pm-intake-head-totals__item--balance">
                        <span className="pm-intake-head-totals__k">
                          {customerBalanceResetPending ? "חוב פתוח לאחר איפוס" : "חוב פתוח"}:
                        </span>
                        <strong
                          className={[
                            "pm-intake-head-totals__v",
                            intakeStripOpenDebtUsd > 0.01
                              ? "pm-intake-head-totals__v--debt"
                              : "pm-intake-head-totals__v--payments",
                          ].join(" ")}
                          dir="ltr"
                        >
                          {fmtUsdDisplay(intakeStripOpenDebtUsd)}
                        </strong>
                      </span>
                    </>
                  ) : null}
                  {showResetBalanceBtn ? (
                    <>
                      <span className="pm-intake-head-totals__sep" aria-hidden>
                        ·
                      </span>
                      <button
                        type="button"
                        className={[
                          "pm-reset-balance-btn",
                          "pm-reset-balance-btn--inline",
                          canApplyResetCustomerBalance ? "pm-reset-balance-btn--ready" : "",
                          customerBalanceResetPending ? "pm-reset-balance-btn--preview" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        disabled={!canApplyResetCustomerBalance && !customerBalanceResetPending}
                        onClick={() => {
                          if (customerBalanceResetPending) {
                            setCustomerBalanceResetPending(false);
                            onToast("תצוגת איפוס יתרה בוטלה");
                            return;
                          }
                          setResetCustomerConfirmOpen(true);
                        }}
                        title="איפוס יתרה — תצוגה בלבד עד שמירת תשלום"
                      >
                        {customerBalanceResetPending ? "ביטול תצוגת איפוס" : "איפוס יתרה"}
                      </button>
                    </>
                  ) : null}
                  {customerBalanceResetPending ? (
                    <span className="pm-intake-head-totals__note">תצוגת איפוס — יוחל בשמירת התשלום</span>
                  ) : null}
                </div>
              ) : null}
              <div className="payment-modal-table-scroll" ref={tableScrollRef}>
                <table className="payment-modal-table" dir="rtl">
                  <thead>
                    <tr>
                      <th className="pm-mono payment-modal-th-code">הזמנה</th>
                      <th>תאריך</th>
                      <th>שבוע</th>
                      <th className="pm-num">שער</th>
                      <th className="pm-num pm-th-amt">סכום מקור ($)</th>
                      <th className="pm-num pm-th-commission">עמלה ($)</th>
                      <th className="pm-num">שולם ($)</th>
                      <th className="pm-num pm-th-total">יתרה ($)</th>
                      <th>תשלום אחרון</th>
                      <th>סטטוס</th>
                      <th className="payment-modal-th-check" aria-label="עדיפות לסגירה" />
                      <th className="payment-modal-th-check" aria-label="סגור בתשלום" />
                    </tr>
                  </thead>
                  <tbody>
                    {matched.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="payment-modal-empty">
                          {customer ? "אין הזמנות ללקוח זה" : "בחרו לקוח"}
                        </td>
                      </tr>
                    ) : (
                      matched.map((row) => {
                        const isCommissionResetPreview = commissionResetIds.includes(row.id);
                        const commissionUsd = Number(row.commissionUsd);
                        const ledgerBal = isCommissionResetPreview ? 0 : orderRowLedgerBalance(row);
                        const commissionPreviewPlan = isCommissionResetPreview
                          ? planCommissionDebtClosureFromNumbers({
                              commissionUsd: Number(
                                orders.find((o) => o.id === row.id)?.commissionUsd ?? commissionUsd,
                              ),
                              totalUsd: Number(
                                orders.find((o) => o.id === row.id)?.totalAmountUsd ?? row.totalAmountUsd,
                              ),
                              paidUsd: Number(row.dbPaidUsd) || 0,
                            })
                          : null;
                        const displayCommissionUsd = isCommissionResetPreview
                          ? (commissionPreviewPlan?.afterCommissionUsd ?? commissionUsd)
                          : commissionUsd;
                        const displayCommissionBefore = isCommissionResetPreview
                          ? (commissionPreviewPlan?.beforeCommissionUsd ?? commissionUsd)
                          : null;
                        const ledgerSt = displayedLedgerStatus(ledgerBal);
                        return (
                        <tr
                          key={row.id}
                          className={[
                            "payment-modal-tr--clickable",
                            ledgerRowClass(ledgerSt),
                            isCommissionResetPreview ? "payment-modal-tr--commission-closure" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => void openPaymentHistory(row.id)}
                          title="לחץ לצפייה בהיסטוריית תשלומים"
                        >
                          <td dir="ltr" className="pm-mono payment-modal-td-code payment-modal-td-order-num">
                            {canEditOrders ? (
                              <button
                                type="button"
                                className="payment-modal-order-num-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openOrderForEdit(row.id);
                                }}
                              >
                                {row.orderNumber ?? "—"}
                              </button>
                            ) : (
                              (row.orderNumber ?? "—")
                            )}
                          </td>
                          <td dir="ltr" className="payment-modal-td-date">
                            {row.dateYmd}
                          </td>
                          <td dir="ltr" className="payment-modal-td-week">
                            {row.week ?? "—"}
                          </td>
                          <td dir="ltr" className="pm-num">
                            {fmtRate(row.rate)}
                          </td>
                          <td dir="ltr" className="pm-num pm-num--usd">
                            {fmtUsdDisplay(row.amountUsd)}
                          </td>
                          <td dir="ltr" className="pm-num pm-num--commission" onClick={(e) => e.stopPropagation()}>
                            <div className="pm-commission-cell">
                              <span
                                className={isCommissionResetPreview ? "pm-commission-preview pm-commission-preview--closure" : ""}
                              >
                                {isCommissionResetPreview && displayCommissionBefore != null ? (
                                  <>
                                    <span className="pm-commission-delta-old" dir="ltr">
                                      {fmtUsdDisplay(displayCommissionBefore)}
                                    </span>
                                    <span className="pm-commission-delta-arrow" aria-hidden>
                                      →
                                    </span>
                                    <span className="pm-commission-delta-new" dir="ltr">
                                      {fmtUsdDisplay(displayCommissionUsd)}
                                    </span>
                                  </>
                                ) : (
                                  fmtUsdDisplay(displayCommissionUsd)
                                )}
                              </span>
                              {customer && viewerIsAdmin && orderRowLedgerBalance(row) > 0.01 && !isCommissionResetPreview ? (
                                <button
                                  type="button"
                                  className="pm-commission-reset-btn"
                                  onClick={() => {
                                    const rem = roundMoney2(Math.max(0, orderRowLedgerBalance(row)));
                                    const oldCom = Number(row.commissionUsd) || 0;
                                    const plan = planCommissionDebtClosureFromNumbers({
                                      commissionUsd: oldCom,
                                      totalUsd: Number(row.totalAmountUsd) || 0,
                                      paidUsd: Number(row.dbPaidUsd) || 0,
                                    });
                                    setCommissionResetTarget({
                                      orderId: row.id,
                                      orderNumber: row.orderNumber ?? null,
                                      oldCommissionUsd: oldCom,
                                      remainingUsd: rem,
                                      newCommissionUsd: plan.afterCommissionUsd,
                                    });
                                  }}
                                  title="איפוס עמלה — סגירת יתרה (Y−X)"
                                >
                                  איפוס
                                </button>
                              ) : null}
                              {isCommissionResetPreview ? (
                                <span className="payment-modal-preview-tag pm-commission-preview-tag">
                                  סגירת חוב בעמלה
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td dir="ltr" className="pm-num pm-num--paid-usd">
                            {fmtUsdDisplay(roundMoney2(Math.max(0, row.dbPaidUsd)))}
                          </td>
                          <td dir="ltr" className={`pm-num pm-num--total-usd pm-num--bal-${ledgerSt}`}>
                            {fmtUsdDisplay(ledgerBal)}
                          </td>
                          <td dir="ltr" className="payment-modal-td-date">
                            {row.lastPaymentDateYmd ?? "—"}
                          </td>
                          <td className="payment-modal-td-status">
                            <span className={`pm-status badge ${ledgerStatusClass(ledgerSt)}`}>
                              {displayedLedgerStatusLabel(ledgerBal)}
                            </span>
                          </td>
                          <td className="payment-modal-td-check" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={rowChecked(row.id)}
                              disabled={!canCloseDebtForRow(row)}
                              onChange={() => toggleRow(row.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="עדיפות לסגירה"
                            />
                          </td>
                          <td className="payment-modal-td-check" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="pm-close-debt-btn"
                              disabled={!canCloseDebtForRow(row)}
                              onClick={() => addLineFromOrder(row)}
                            >
                              סגור בתשלום
                            </button>
                          </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <aside className="payment-modal-side payment-modal-side--compact payment-summary" dir="rtl">
            <div className="payment-modal-side-body">
              <div className="payment-modal-side-inner payment-modal-side-inner--payment-only">
                <label className="payment-modal-lbl payment-modal-lbl--micro">
                  קוד תשלום
                  <div className="payment-navigation-row" dir="ltr" aria-label="ניווט בין קליטות תשלום">
                    <button
                      type="button"
                      className={[
                        "payment-nav-arrow",
                        paymentNavLoading ? "payment-nav-arrow--busy" : "",
                        !previousPaymentId && canNavigateSavedPayments ? "payment-nav-arrow--edge" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label="קליטת תשלום קודמת"
                      disabled={prevPaymentNavDisabled}
                      onClick={goToPreviousPayment}
                    >
                      {paymentNavLoading ? <span className="payment-modal-save-spinner" aria-hidden /> : "◀"}
                    </button>
                    {paymentCaptureNavLabel ? (
                      <div className="payment-nav-code" dir="ltr" aria-label="קוד קליטת תשלום">
                        {paymentCaptureNavLabel}
                      </div>
                    ) : paymentCodePreviewPending ? (
                      <div
                        className="payment-nav-code payment-modal-code-pending"
                        dir="ltr"
                        aria-busy="true"
                        title="טוען קוד תשלום"
                      >
                        טוען קוד תשלום…
                      </div>
                    ) : (
                      <div className="payment-nav-code" dir="ltr">
                        —
                      </div>
                    )}
                    <button
                      type="button"
                      className={[
                        "payment-nav-arrow",
                        paymentNavLoading ? "payment-nav-arrow--busy" : "",
                        !nextPaymentId && canNavigateSavedPayments ? "payment-nav-arrow--edge" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label="קליטת תשלום הבאה"
                      disabled={nextPaymentNavDisabled}
                      onClick={goToNextPayment}
                    >
                      {paymentNavLoading ? <span className="payment-modal-save-spinner" aria-hidden /> : "▶"}
                    </button>
                  </div>
                </label>

                <div className="payment-upd-addrow">
                  <button type="button" className="payment-upd-add-btn" onClick={() => addPaymentLine()} disabled={saveBusy}>
                    + הוסף תשלום
                  </button>
                  <button
                    type="button"
                    ref={saveAndNewButtonRef}
                    className={`payment-upd-save-new-btn${saveBusy ? " is-loading" : ""}`}
                    onClick={() => void onSaveAndNew()}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      if (!saveBusy && customer) void onSaveAndNew();
                    }}
                    disabled={saveBusy || !customer || paymentIsCancelled}
                    title="שומר את התשלום ומיד פותח טופס ריק לתשלום הבא — בלי לסגור את החלון"
                  >
                    {saveBusy ? (
                      <>
                        <span className="payment-modal-save-spinner" aria-hidden />
                        שומר…
                      </>
                    ) : (
                      "שמור וחדש"
                    )}
                  </button>
                  <div className="payment-upd-addrow-meta">
                    <span>מס׳ תשלומים: </span>
                    <strong>{payments.length}</strong>
                  </div>
                </div>

                <div className="payment-upd-lines" aria-label="תשלומים שנוספו">
                  {payments.map((p, idx) => {
                    const ordinal = payments.length - idx;
                    const isLatest = idx === 0;
                    return (
                      <PaymentLineDualCard
                        key={p.id}
                        line={p}
                        ordinal={ordinal}
                        isLatest={isLatest}
                        rateN={rateN}
                        highlightInvalidChecks={highlightInvalidCheckFields}
                        firstAmountInputRef={idx === 0 ? firstAmountInputRef : undefined}
                        onUpdate={(patch) => updatePaymentLine(p.id, patch)}
                        onRemove={() => removePaymentLine(p.id)}
                        onEnterInFirstAmount={
                          idx === 0
                            ? () => {
                                if (saveBusy) return;
                                if (!customer) {
                                  focusCustomerCodeInput();
                                  return;
                                }
                                focusSavePrimaryButton();
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>

              </div>
            </div>

            <div className="payment-modal-side-sticky payment-summary-stack payment-summary-stack--v2">
              <div className="payment-upd-sticky-total payment-upd-sticky-total--basis-led" aria-live="polite">
                <div className="payment-upd-sticky-total-amounts">
                  <AnimatedMoneyValue
                    className="payment-upd-sticky-total-usd money-amount"
                    dir="ltr"
                    value={fmtUsdDisplay(totals.totalUsd)}
                  />
                  <div className="payment-upd-sticky-total-lbl">סה״כ לתשלום</div>
                  {stickyIlsEntered > 0.005 ? (
                    <AnimatedMoneyValue
                      className="payment-upd-sticky-total-ils money-amount payment-upd-sticky-total-ils--hint"
                      dir="ltr"
                      value={`₪${fmtFooterAmount(stickyIlsEntered)} נקלט`}
                    />
                  ) : null}
                </div>
              </div>
              {paymentIsCancelled ? (
                <div className="payment-modal-cancelled-banner" role="status">
                  תשלום זה בוטל
                  {loadedPayment?.cancelReason ? (
                    <span className="payment-modal-cancelled-reason"> — {loadedPayment.cancelReason}</span>
                  ) : null}
                </div>
              ) : null}
              {saveErr ? <div className="payment-modal-err payment-modal-err--sm">{saveErr}</div> : null}
              <div className="payment-modal-save-actions">
                {canCancelSavedPayment ? (
                  <button
                    type="button"
                    className="payment-cancel-payment-btn"
                    disabled={saveBusy || cancelPaymentBusy || paymentNavLoading}
                    onClick={() => setCancelPaymentOpen(true)}
                  >
                    בטל תשלום
                  </button>
                ) : null}
                <button
                  type="button"
                  ref={savePrimaryButtonRef}
                  className={`btn btn-primary btn-save payment-modal-save payment-modal-save--v2${saveBusy ? " loading" : ""}`}
                  disabled={saveBusy || !customer || paymentIsCancelled}
                  onClick={() => void onSaveAndClose()}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    if (!saveBusy && customer) void onSaveAndClose();
                  }}
                >
                  {saveBusy ? (
                    <>
                      <span className="payment-modal-save-spinner" aria-hidden />
                      שומר…
                    </>
                  ) : (
                    "שמור תשלום"
                  )}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <OrderEditModal
        orderId={orderEditId}
        financial={financial}
        onToast={onToast}
        canCreateOrders={canCreateOrders}
        canEditOrders={canEditOrders}
        onClose={() => setOrderEditId(null)}
        onSaved={() => {
          if (customer?.id) void loadCustomerOrders(customer.id);
        }}
      />
      <PaymentOpenDebtDetailModal
        open={openDebtDetailOpen}
        rows={matched}
        onClose={() => setOpenDebtDetailOpen(false)}
        onOrderClick={(orderId) => openWindow({ type: "orderCapture", props: { mode: "edit", orderId } })}
      />
      {resetCustomerConfirmOpen ? (
        <div
          className="adm-oc-edit-request-backdrop"
          role="presentation"
          onClick={() => setResetCustomerConfirmOpen(false)}
        >
          <div
            className="payment-nav-confirm-modal payment-reset-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h4>האם לבצע איפוס יתרה?</h4>
            <ul className="payment-reset-confirm-deltas">
              <li>
                חוב נוכחי:{" "}
                <strong dir="ltr">${fmtUsdDisplay(resetBalanceConfirm.openDebtUsd)}</strong>
              </li>
              <li>
                עמלה נוכחית:{" "}
                <strong dir="ltr">${fmtUsdDisplay(resetBalanceConfirm.openCommissionUsd)}</strong>
              </li>
            </ul>
            <p className="payment-reset-confirm-note">בפס הסיכומים העליון (בלבד) יוצג:</p>
            <ul className="payment-reset-confirm-deltas payment-reset-confirm-deltas--after">
              <li>
                חוב פתוח לאחר איפוס: <strong dir="ltr">$0.00</strong>
              </li>
              <li>
                עמלות מצטברות:{" "}
                <strong dir="ltr">
                  {resetBalanceConfirm.afterCommissionUsd < -0.01
                    ? `${fmtUsdDisplay(Math.abs(resetBalanceConfirm.afterCommissionUsd))}-`
                    : fmtUsdDisplay(resetBalanceConfirm.afterCommissionUsd)}
                </strong>
                <span className="adm-muted-keys"> (עמלה − יתרה)</span>
              </li>
            </ul>
            <p className="adm-muted-keys payment-reset-confirm-note">
              טבלת ההזמנות לא תשתנה. האיפוס במסד הנתונים יבוצע רק בלחיצה על שמור תשלום.
            </p>
            {totals.totalUsd <= 0.01 ? (
              <p className="adm-muted-keys payment-reset-confirm-note">
                יש להוסיף תשלום ולשמור כדי ליישם את האיפוס במערכת.
              </p>
            ) : null}
            <div className="payment-nav-confirm-actions">
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--dense"
                onClick={() => setResetCustomerConfirmOpen(false)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--dense"
                disabled={!canApplyResetCustomerBalance}
                onClick={() => {
                  setResetCustomerConfirmOpen(false);
                  setCustomerBalanceResetPending(true);
                  onToast(
                    totals.totalUsd > 0.01
                      ? "תצוגת איפוס יתרה — יוחל בשמירת התשלום"
                      : "תצוגת איפוס יתרה — הוסיפו תשלום ושמרו כדי ליישם",
                  );
                }}
              >
                הצג בתצוגה
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {navUnsavedOpen ? (
        <div
          className="adm-oc-edit-request-backdrop"
          role="presentation"
          onClick={() => {
            if (paymentNavLoading) return;
            setNavUnsavedOpen(null);
          }}
        >
          <div
            className="payment-nav-confirm-modal payment-reset-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h4>יש שינויים שלא נשמרו</h4>
            <p>לעבור קליטה אחרת? השינויים הנוכחיים לא יישמרו.</p>
            <div className="payment-nav-confirm-actions">
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--dense"
                disabled={paymentNavLoading}
                onClick={() => setNavUnsavedOpen(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--dense"
                disabled={paymentNavLoading}
                onClick={() => confirmNavUnsavedAndProceed()}
              >
                כן
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {cancelPaymentOpen ? (
        <div
          className="adm-oc-edit-request-backdrop"
          role="presentation"
          onClick={() => {
            if (cancelPaymentBusy) return;
            setCancelPaymentOpen(false);
          }}
        >
          <div
            className="payment-nav-confirm-modal payment-reset-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h4>ביטול תשלום</h4>
            <p>
              לבטל את <strong dir="ltr">{displayedPaymentCode || "קליטה זו"}</strong>? החוב יחזור אוטומטית. התשלום לא
              יימחק מהמערכת.
            </p>
            <label className="payment-cancel-reason-lbl">
              סיבת ביטול (אופציונלי)
              <textarea
                className="payment-cancel-reason-input"
                rows={2}
                value={cancelReasonDraft}
                onChange={(e) => setCancelReasonDraft(e.target.value)}
                disabled={cancelPaymentBusy}
              />
            </label>
            <div className="payment-nav-confirm-actions">
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--dense"
                disabled={cancelPaymentBusy}
                onClick={() => setCancelPaymentOpen(false)}
              >
                חזרה
              </button>
              <button
                type="button"
                className="adm-btn payment-cancel-confirm-btn adm-btn--dense"
                disabled={cancelPaymentBusy}
                onClick={() => void executeCancelPayment()}
              >
                {cancelPaymentBusy ? "מבטל…" : "בטל תשלום"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {commissionResetTarget ? (
        <div
          className="adm-oc-edit-request-backdrop"
          role="presentation"
          onClick={() => setCommissionResetTarget(null)}
        >
          <div
            className="payment-nav-confirm-modal payment-reset-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h4>אישור איפוס עמלה — סגירת חוב</h4>
            <p className="payment-reset-confirm-copy">
              הזמנה:{" "}
              <strong dir="ltr">{commissionResetTarget.orderNumber ?? commissionResetTarget.orderId}</strong>
            </p>
            <ul className="payment-reset-confirm-deltas">
              <li>
                יתרה:{" "}
                <strong dir="ltr">
                  {fmtUsdDisplay(commissionResetTarget.remainingUsd)} → 0.00
                </strong>
              </li>
              <li>
                עמלה:{" "}
                <strong dir="ltr">
                  {fmtUsdDisplay(commissionResetTarget.oldCommissionUsd)} →{" "}
                  {fmtUsdDisplay(commissionResetTarget.newCommissionUsd)}
                </strong>
              </li>
            </ul>
            <p className="payment-reset-confirm-note">
              החוב ייסגר בהתאמת עמלה (לא תשלום). יוחל בשמירת קליטת התשלום.
            </p>
            <div className="payment-nav-confirm-actions">
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--dense"
                onClick={() => setCommissionResetTarget(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--dense"
                onClick={() => {
                  setCommissionResetIds((prev) => {
                    if (prev.includes(commissionResetTarget.orderId)) return prev;
                    return [...prev, commissionResetTarget.orderId];
                  });
                  console.log("[commission.reset.preview]", {
                    orderNumber: commissionResetTarget.orderNumber,
                    remainingUsd: commissionResetTarget.remainingUsd,
                    oldCommissionUsd: commissionResetTarget.oldCommissionUsd,
                    newCommissionUsd: commissionResetTarget.newCommissionUsd,
                  });
                  setCommissionResetTarget(null);
                }}
              >
                אישור
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {paymentHistoryOrderId ? (
        <div
          className="adm-oc-edit-request-backdrop"
          role="presentation"
          onClick={closePaymentHistory}
        >
          <div
            className="payment-nav-confirm-modal pm-order-payments-popover"
            role="dialog"
            aria-modal="true"
            aria-label="היסטוריית תשלומים"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <div className="pm-order-payments-popover-head">
              <h4>היסטוריית תשלומים</h4>
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={closePaymentHistory}>
                סגור
              </button>
            </div>
            {paymentHistoryBusy ? <p className="payment-modal-hint">טוען…</p> : null}
            {paymentHistoryErr ? <p className="payment-modal-err">{paymentHistoryErr}</p> : null}
            {!paymentHistoryBusy && !paymentHistoryErr && paymentHistoryRows.length === 0 ? (
              <p className="payment-modal-hint">אין תשלומים רשומים להזמנה זו</p>
            ) : null}
            {paymentHistoryRows.length > 0 ? (
              <table className="pm-order-payments-table" dir="rtl">
                <thead>
                  <tr>
                    <th>קוד תשלום</th>
                    <th>תאריך</th>
                    <th className="pm-num">סכום ($)</th>
                    <th className="pm-num">סכום (₪)</th>
                    <th>בוצע על ידי</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentHistoryRows.map((p) => (
                    <tr key={p.id}>
                      <td dir="ltr" className="pm-mono">{p.paymentCode ?? "—"}</td>
                      <td dir="ltr">{p.paymentDateYmd}</td>
                      <td dir="ltr" className="pm-num">{fmtUsdDisplay(Number(p.amountUsd))}</td>
                      <td dir="ltr" className="pm-num">{p.amountIls ? fmtIlsDisplay(Number(p.amountIls)) : "—"}</td>
                      <td>{p.createdByName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </div>
      ) : null}
      <CustomerPaymentOverageModal
        open={overageModalOpen}
        preview={overagePreview}
        busy={saveBusy}
        onConfirm={() => void onOverageConfirm()}
        onCancel={onOverageCancel}
      />
    </>
  );
}

