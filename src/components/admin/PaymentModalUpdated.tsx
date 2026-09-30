"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { PaymentMethod } from "@prisma/client";
import { logPaymentAllocationPreSave } from "@/lib/payment-allocation-debug";
import { dispatchOrdersListRefresh } from "@/lib/orders-list-refresh-bus";
import {
  allocatePaymentAcrossOrders,
  buildAllocationsFromMatch,
  debtStatus,
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
import { computePaymentOveragePreview } from "@/lib/customer-balance";
import {
  fetchPaymentIntakeCustomerOrdersAction,
  fetchOrderPaymentHistoryAction,
  type OrderPaymentHistoryRow,
  type PaymentIntakeCustomerPayload,
  type PaymentIntakeCustomerPaymentRow,
} from "@/app/admin/payments/intake/actions";
import {
  applyIntakePaymentMethodSwapAction,
} from "@/app/admin/capture/actions";
import { sumCustomerPaymentsUsd } from "@/lib/payment-intake-customer-kpi";
import { aggregateLivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import { buildPostSaveRemainingSummary } from "@/lib/payment-intake-method-control";
import { PaymentMethodControlModal } from "@/components/admin/PaymentMethodControlModal";
import { PaymentMethodAutoAdjustModal } from "@/components/admin/PaymentMethodAutoAdjustModal";
import { PaymentIntakeDeviationModal } from "@/components/admin/PaymentIntakeDeviationModal";
import { usePaymentIntakePlanningViews } from "@/hooks/usePaymentIntakePlanningViews";
import {
  computeOrderOpenDebtUsd,
  formatPaymentBalanceIlsLine,
  formatPaymentBalanceUsdLine,
  type PaymentBalanceDisplay,
} from "@/lib/order-remaining-debt";
import {
  computePaymentIntakeApplyUsd,
  isExistingPaymentUnchanged,
  isExistingSavedPayment,
  paymentIntakeCustomerOpenDebtUsd,
} from "@/lib/payment-intake-customer-debt";
import { buildCustomerFinancialState } from "@/lib/customer-account-balances-shared";
import { sumPaymentIntakeWeekScopedRemainingUsd } from "@/lib/payment-intake-order-filter";
import {
  buildPaymentPreview,
  computePendingCreditApplyUsd,
  remainingToPayCardDisplayFromPreview,
  toPaymentPreviewOrders,
} from "@/lib/payment-intake-preview";
import { convertDebtUsdToIlsIncludingVat } from "@/lib/usd-balance-ils-vat";
import { softRefreshPaymentIntakeOrders } from "@/lib/payment-intake-orders-source";
import { PaymentDocumentRateIcons } from "@/components/admin/PaymentDocumentRateIcons";
import { attachDraftDocumentsAction } from "@/app/admin/documents/actions";
import {
  PAYMENT_BUCKET_LABELS,
  type EnteredBucketUsd,
} from "@/lib/payment-breakdown-shared";
import {
  computeIntakeSaveDeviations,
  intakeSaveHasDeviations,
  intakeHasMethodMismatch,
  filterIntakeCorrectionRowsForDisplay,
  intakeHasRateMismatch,
  intakeHasOpenBalanceShortfall,
  intakeDeviationModalRows,
  buildIntakeDeviationModalView,
  bucketKeyToDbMethod,
  type IntakeSaveDeviationRow,
  type IntakeDeviationModalView,
} from "@/lib/cash-control-intake-breakdown";
import { PaymentLiveSummaryCards } from "@/components/admin/PaymentLiveSummaryCards";
import type { PaymentPostSaveSummary } from "@/components/admin/PaymentPostSaveSummaryModal";
import { BalanceResetConfirmModal } from "@/components/admin/BalanceResetConfirmModal";
import { DebtBreakdownModal } from "@/components/admin/debt-breakdown/DebtBreakdownModal";
import {
  computePaymentIntakeLiveTotals,
  formatIntakeLiveBalanceDisplay,
  type CommissionResetOrderPreview,
} from "@/lib/payment-intake-live-calculator";
import { planCommissionDebtClosureFromNumbers } from "@/lib/commission-debt-closure";
import {
  BALANCE_RESET_TOLERANCE_USD,
  computeOrderBalanceResetRows,
  summarizeOrderBalanceResetRows,
} from "@/lib/balance-reset-calculation";
import {
  fetchCustomerOpenDebtAction,
  fetchOrderForPaymentContextAction,
  previewPaymentCodeForCaptureAction,
  resolveCapturePaymentByCodeQueryAction,
  type CustomerSearchRow,
} from "@/app/admin/capture/actions";
import { workCountryFromCapturePaymentCode } from "@/lib/payment-code-navigation-shared";
import { PaymentNavigator } from "@/components/admin/PaymentNavigator";
import {
  clonePaymentCaptureSnapshot,
  type PaymentCaptureEntryData,
  type PaymentCaptureSnapshot,
} from "@/lib/payment-capture-snapshot";
import {
  cacheSharedPaymentEntry,
  cacheSharedPaymentSnapshot,
  getSharedPaymentSnapshotCache,
} from "@/lib/payment-capture-shared-cache";
import { fetchPaymentEntryClient } from "@/lib/payment-entry-client";
import { logPaymentCapturePerf } from "@/lib/payment-capture-perf";
import {
  fetchPaymentIntakeBalancesClient,
  fetchPaymentIntakeCustomerPaymentsClient,
  fetchPaymentIntakeOrdersClient,
} from "@/lib/payment-intake-client";
import { computePaymentIntakeCommissionDisplayUsd } from "@/lib/payment-intake-commission-preview";
import { CommissionBalancePopover } from "@/components/admin/CommissionBalancePopover";
import { CreditBalancePopover } from "@/components/admin/CreditBalancePopover";
import { loadFinancialSettingsForPaymentCaptureAction } from "@/app/admin/financial/actions";
import { WEGO_FINANCIAL_SETTINGS_SAVED } from "@/lib/financial-settings-bus";
import type { SerializedFinancial } from "@/lib/financial-settings.shared";
import type { PaymentWindowProps } from "@/lib/admin-windows";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { OrderEditModal } from "@/components/admin/OrderEditModal";
import { Button } from "@/components/ui/Button";
import { BarChart3, CreditCard, DollarSign, FileText, Home, Scale, Search, TrendingDown, Wallet } from "lucide-react";
import { normalizeOrderSourceCountry, type OrderCountryCode } from "@/lib/order-countries";
import {
  DEFAULT_WORK_COUNTRY,
  workCountryFromOrderSourceCountry,
  type WorkCountryCode,
} from "@/lib/work-country";
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
import { getNextAhWeek, getPrevAhWeek } from "@/lib/weeks/ah-week";
import { resolvePaymentIntakeAccountingPeriod } from "@/lib/payment-intake-accounting-period";
import {
  defaultPaymentIntakeDateYmd,
  defaultPaymentIntakeWeekCode,
} from "@/lib/payment-intake-default-week";
import {
  defaultOrderSourceDateYmdForIntakeWeek,
  resolveOrderSourceWeekCode,
  weekCodeForPaymentIntakeOrders,
} from "@/lib/payment-intake-week-context";
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
  applyCustomerCreditToOpenOrdersAction,
  applyPaymentSurplusDispositionAction,
  resetCustomerOutstandingBalancesAction,
  savePaymentUpdatedAction,
} from "@/app/admin/payments-updated/actions";
import {
  createInvoiceCancelRequestAction,
  getPaymentCancelRequestHintAction,
  type PaymentCancelRequestHint,
} from "@/app/admin/invoice-cancel-requests/actions";
import { CustomerPaymentOverageModal, type SurplusDisposition } from "@/components/admin/CustomerPaymentOverageModal";
import { OrderCommissionDetailModal } from "@/components/admin/OrderCommissionDetailModal";
import { PaymentIntakeCorrectionBanner } from "@/components/admin/PaymentIntakeCorrectionBanner";
import {
  PaymentShortfallAfterSaveModal,
  type PaymentShortfallResolution,
} from "@/components/admin/PaymentShortfallAfterSaveModal";
import { computePaymentOverpayment, formatOverpaymentUsdSigned } from "@/lib/payment-overpayment";
import {
  describePostAdjustmentValidation,
  evaluatePaymentIntakeSaveGates,
} from "@/lib/payment-intake-save-gates";
import {
  applyIntentOrderChangesToIntakeOrders,
  planPaymentIntentAdjustments,
} from "@/lib/payment-method-payment-intent";
import { BalanceResetCreditConfirmModal } from "@/components/admin/BalanceResetCreditConfirmModal";
import { dispatchCashControlRefresh } from "@/lib/cash-control-refresh-bus";
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
  resolveCustomerEnterSelection,
  searchCustomerSuggestionsClient,
} from "@/lib/customer-search-client";

const COUNTRY_BADGE_SHORT: Record<OrderCountryCode, string> = {
  TURKEY: "טורקיה",
  CHINA: "סין",
  UAE: "אמירויות",
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

/** שבוע קליטה מהרשומה — weekCode שמור, או ירושה מתאריך תשלום (קליטות ישנות) */
function intakeWeekFromPaymentEntry(entry: {
  weekCode?: string | null;
  paymentDateYmd: string;
}): string {
  const fromWeek = normalizeAhWeekCode(entry.weekCode ?? "");
  if (fromWeek && getAhWeekRange(fromWeek)) return fromWeek;
  return normalizeAhWeekCode(weekCodeFromYmd(entry.paymentDateYmd)) ?? DEFAULT_WEEK_CODE;
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

function orderSourceWeekForIntakeWeek(
  intakeWeek: string,
  orderDateYmd?: string | null,
): string {
  return (
    weekCodeForPaymentIntakeOrders(intakeWeek, orderDateYmd) ??
    resolveOrderSourceWeekCode(intakeWeek) ??
    intakeWeek
  );
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

type PaymentEntryResponse = {
  id: string;
  paymentCode: string | null;
  paymentNumber?: number | null;
  /** שבוע קליטה/עבודה — נפרד מ-createdAt */
  weekCode?: string | null;
  paymentDateYmd: string;
  /** תאריך ביצוע קליטה לבקרת קופה — שבת השבוע הפיננסי (N−1), לא createdAt */
  intakeDateYmd?: string | null;
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

function createNewCaptureLoadedPayment(
  paymentCode: string,
  homeWeek?: string,
): PaymentEntryResponse {
  const now = new Date();
  const week = defaultPaymentIntakeWeekCode(homeWeek);
  const closing = defaultPaymentIntakeDateYmd(week);
  return {
    id: NEW_CAPTURE_ROW_ID,
    paymentCode,
    weekCode: week,
    paymentDateYmd: closing,
    intakeDateYmd: closing,
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

type PaymentCustomerHydrateCache = {
  customer: PaymentIntakeCustomerPayload;
  orders: PaymentIntakeOrderRow[];
  customerPayments: PaymentIntakeCustomerPaymentRow[];
};

function paymentCustomerHydrateKey(
  customerId: string,
  weekCode: string,
  workCountry: WorkCountryCode,
): string {
  return `${customerId}|${weekCode}|${workCountry}`;
}

/** מדינת מסמך לשאילתת טבלת הזמנות — לא תלוי בהזמנות שכבר נטענו */
function paymentIntakeTableWorkCountry(
  countryOverride: "AUTO" | OrderCountryCode,
  paymentCode: string,
  fallbackGlobal: OrderCountryCode,
): WorkCountryCode {
  if (countryOverride !== "AUTO") {
    return workCountryFromOrderSourceCountry(countryOverride);
  }
  const fromCode = workCountryFromCapturePaymentCode(paymentCode);
  if (fromCode) return fromCode;
  return workCountryFromOrderSourceCountry(fallbackGlobal);
}

/** מפתח טיוטה למסמכים מצורפים בקליטת תשלום חדש (לפני שקיים paymentId) */
function makeDocDraftKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `draft-${crypto.randomUUID()}`;
    }
  } catch {
    /* noop */
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function baselineUsdFromEntry(snap: PaymentEntryResponse, fallbackRate: number): number {
  const id = snap.id?.trim();
  if (!id || id === NEW_CAPTURE_ROW_ID) return 0;
  const rateRaw = snap.dollarRate ? Number(snap.dollarRate) : fallbackRate;
  const rateN = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : fallbackRate;
  if (snap.lines.length === 0) return 0;
  return calculateTotals(snap.lines, rateN, DEFAULT_VAT_RATE).totalUsd;
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

function buildEnteredByBucket(kpis: ReturnType<typeof aggregateLivePaymentFormKpis>): EnteredBucketUsd[] {
  return [
    { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: kpis.cash.totalUsd },
    { bucket: "BANK_TRANSFER", label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER, enteredUsd: kpis.bankTransfer.totalUsd },
    { bucket: "CREDIT", label: PAYMENT_BUCKET_LABELS.CREDIT, enteredUsd: kpis.credit.totalUsd },
    { bucket: "CHECK", label: PAYMENT_BUCKET_LABELS.CHECK, enteredUsd: kpis.checks.totalUsd },
    { bucket: "OTHER", label: PAYMENT_BUCKET_LABELS.OTHER, enteredUsd: kpis.other.totalUsd },
  ];
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
  const { globalWeek, globalCountry } = useAdminGlobal();
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
  const overageConfirmInFlightRef = useRef(false);

  const [draftCustomer, setDraftCustomer] = useState<Record<CustFieldKey, string>>(() => ({
    ...EMPTY_CUSTOMER_DRAFT,
  }));
  const lastEditedFieldRef = useRef<CustFieldKey>("code");
  const draftCustomerRef = useRef(draftCustomer);
  draftCustomerRef.current = draftCustomer;
  const custSearchGenRef = useRef(0);
  const customerHitsRef = useRef<CustomerSearchRow[]>([]);
  const custActiveIndexRef = useRef(-1);
  const custHitsQueryRef = useRef<string | null>(null);
  const custPendingSearchRef = useRef<{ field: CustFieldKey; query: string; gen: number } | null>(null);
  const pendingEnterSelectRef = useRef(false);
  const customerCodeEnterBusyRef = useRef(false);
  const customerCodeEnterGenRef = useRef(0);
  const selectedCustomerRef = useRef<{ id: string; code: string | null } | null>(null);

  const [editingBadge, setEditingBadge] = useState<BadgeEditField>(null);
  const [countryOverride, setCountryOverride] = useState<"AUTO" | OrderCountryCode>("AUTO");

  const [custDdOpen, setCustDdOpen] = useState(false);
  const [custSearchNoHits, setCustSearchNoHits] = useState(false);
  const [custSearching, setCustSearching] = useState(false);
  const [custSearchField, setCustSearchField] = useState<CustFieldKey | null>(null);
  const [searchTick, setSearchTick] = useState(0);
  const [customerHits, setCustomerHits] = useState<CustomerSearchRow[]>([]);
  const [custActiveIndex, setCustActiveIndex] = useState(-1);
  const [customer, setCustomer] = useState<PaymentIntakeCustomerPayload | null>(null);
  const [customerPayments, setCustomerPayments] = useState<PaymentIntakeCustomerPaymentRow[]>([]);
  const [orders, setOrders] = useState<PaymentIntakeOrderRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const customerWorkspaceGenRef = useRef(0);
  const customerSearchPerfRef = useRef<number | null>(null);
  const [customerCodeEnterBusy, setCustomerCodeEnterBusy] = useState(false);
  const [orderEditId, setOrderEditId] = useState<string | null>(null);
  const [paymentHistoryOrderId, setPaymentHistoryOrderId] = useState<string | null>(null);
  const [paymentHistoryRows, setPaymentHistoryRows] = useState<OrderPaymentHistoryRow[]>([]);
  const [paymentHistoryBusy, setPaymentHistoryBusy] = useState(false);
  const [paymentHistoryErr, setPaymentHistoryErr] = useState<string | null>(null);

  /** קליטה שנטענה מ־GET /api/payments/entry או מעטפת קליטה חדשה */
  const [loadedPayment, setLoadedPayment] = useState<PaymentEntryResponse>(() =>
    createNewCaptureLoadedPayment("", globalWeek),
  );
  /** קוד תשלום לתצוגה בלבד — נטען ברקע, לא מעדכן את loadedPayment (מונע remount / איבוד פוקוס) */
  const [previewPaymentCode, setPreviewPaymentCode] = useState<string | null>(null);
  const [paymentCodePreviewPending, setPaymentCodePreviewPending] = useState(true);
  const [paymentDateYmd, setPaymentDateYmd] = useState(() =>
    defaultPaymentIntakeDateYmd(defaultPaymentIntakeWeekCode(globalWeek)),
  );
  /** תאריך מקור ההזמנות (שבת שבוע מקור) — נפרד מתאריך ביצוע התשלום */
  const [orderSourceDateYmd, setOrderSourceDateYmd] = useState(() =>
    defaultOrderSourceDateYmdForIntakeWeek(defaultPaymentIntakeWeekCode(globalWeek)),
  );
  const [editingOrderSourceDate, setEditingOrderSourceDate] = useState(false);
  /** תאריך ביצוע קליטת תשלום — שבת השבוע הפיננסי (N−1), לא שבת שבוע הקליטה */
  const [intakeDateYmd, setIntakeDateYmd] = useState(() =>
    defaultPaymentIntakeDateYmd(defaultPaymentIntakeWeekCode(globalWeek)),
  );
  const [paymentTimeHm, setPaymentTimeHm] = useState(() => formatLocalHm(new Date()));
  const [weekDraft, setWeekDraft] = useState(() => defaultPaymentIntakeWeekCode(globalWeek));
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
  const [saveJustSaved, setSaveJustSaved] = useState(false);
  const saveJustSavedTimerRef = useRef<number | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [postSaveMode, setPostSaveMode] = useState<"new" | "close" | null>(null);
  const [postSavePaymentCode, setPostSavePaymentCode] = useState("");
  const [postSavePaymentNumber, setPostSavePaymentNumber] = useState<number | null>(null);
  const [postSavePrimaryPaymentId, setPostSavePrimaryPaymentId] = useState("");
  const [shortfallModalOpen, setShortfallModalOpen] = useState(false);
  const [shortfallModalMode, setShortfallModalMode] = useState<"preview" | "post_save">("post_save");
  const [shortfallModalSaveMode, setShortfallModalSaveMode] = useState<"new" | "close" | null>(null);
  const [postSaveRemainingUsd, setPostSaveRemainingUsd] = useState(0);
  const [postSaveCommissionBalanceUsd, setPostSaveCommissionBalanceUsd] = useState(0);
  const [postSaveTargetOrderIds, setPostSaveTargetOrderIds] = useState<string[]>([]);
  const [postSaveBusyAction, setPostSaveBusyAction] =
    useState<PaymentShortfallResolution | null>(null);
  const [postSaveError, setPostSaveError] = useState<string | null>(null);
  const [overageModalOpen, setOverageModalOpen] = useState(false);
  const [overagePreview, setOveragePreview] = useState<PaymentOveragePreview | null>(null);
  const [postSaveOverageMode, setPostSaveOverageMode] = useState(false);
  const [intakeDevModalOpen, setIntakeDevModalOpen] = useState(false);
  const [intakeDevRows, setIntakeDevRows] = useState<IntakeSaveDeviationRow[]>([]);
  const [intakeDevAutoFixBusy, setIntakeDevAutoFixBusy] = useState(false);
  const [methodControlOpen, setMethodControlOpen] = useState(false);
  const [autoAdjustOpen, setAutoAdjustOpen] = useState(false);
  const [pendingAutoAdjustIntents, setPendingAutoAdjustIntents] = useState<
    Array<{ method: string; currency: "USD" | "ILS"; amountNative: number }> | null
  >(null);
  /** רענון מקור ההזמנות המשותף (טבלה ראשית + חלון מתוכננים) */
  const [sharedOrdersRefreshing, setSharedOrdersRefreshing] = useState(false);
  /** חזרה לחלון אמצעי מתוכננים אחרי עריכת הזמנה שנפתחה ממנו */
  const reopenMethodControlAfterOrderEditRef = useRef(false);
  const saveAfterOverageRef = useRef<"new" | "close" | null>(null);
  const saveSurplusPendingRef = useRef(false);
  const performSaveRef = useRef<
    ((
      surplusDisposition?: SurplusDisposition | null,
      options?: {
        paymentsOverride?: PaymentLine[];
        autoAdjustIntents?: Array<{ method: string; currency: "USD" | "ILS"; amountNative: number }>;
      },
    ) => ReturnType<typeof performSave>) | null
  >(null);
  const finishAfterSuccessfulSaveRef = useRef<
    ((
      mode: "new" | "close",
      result: Extract<Awaited<ReturnType<typeof performSave>>, { ok: true }>,
    ) => Promise<void>) | null
  >(null);
  const intakeDevPendingSaveRef = useRef(false);
  /** אחרי ניסיון שמירה שנכשל באימות צ׳יקים — מסמן שדות חסרים */
  const [highlightInvalidCheckFields, setHighlightInvalidCheckFields] = useState(false);
  const [resetCustomerConfirmOpen, setResetCustomerConfirmOpen] = useState(false);
  const [creditResetConfirmOpen, setCreditResetConfirmOpen] = useState(false);
  const [balanceResetFromCredit, setBalanceResetFromCredit] = useState(false);
  const baselineSigRef = useRef<string>("");
  const currentSigRef = useRef<string>("");
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  /** תצוגת "איפוס יתרה" — ללא שינוי DB/טבלה עד שמירת תשלום */
  const [customerBalanceResetPending, setCustomerBalanceResetPending] = useState(false);
  /** אינדקס בשורות payments[] (0 = תשלום אחרון שנוסף) — ניווט מקומי בלבד */
  const [activePaymentLineIndex, setActivePaymentLineIndex] = useState(0);
  const paymentLinesContainerRef = useRef<HTMLDivElement | null>(null);
  const [paymentNavLoading, setPaymentNavLoading] = useState(false);
  const loadPaymentRef = useRef<
    (paymentId: string, opts?: { forceNetwork?: boolean }) => Promise<boolean>
  >(async () => false);
  const [commissionResetIds, setCommissionResetIds] = useState<string[]>([]);
  const [cancelPaymentOpen, setCancelPaymentOpen] = useState(false);
  const [cancelPaymentBusy, setCancelPaymentBusy] = useState(false);
  const [cancelReasonDraft, setCancelReasonDraft] = useState("");
  const [cancelNotesDraft, setCancelNotesDraft] = useState("");
  const [cancelRequestHint, setCancelRequestHint] = useState<PaymentCancelRequestHint>({ status: "none" });
  const [debtBreakdownOpen, setDebtBreakdownOpen] = useState(false);
  /** חוב פתוח — מקור יחיד מהשרת (ללא cache מקומי) */
  /** סה״כ USD של תשלום קיים בזמן הטעינה — לחישוב delta בעריכה */
  const [savedBaselinePaymentTotalUsd, setSavedBaselinePaymentTotalUsd] = useState(0);
  /** null = SSOT יתרות עדיין לא נטען (אין לפרש כחוב 0) */
  const [customerOpenDebtSignedUsd, setCustomerOpenDebtSignedUsd] = useState<number | null>(null);
  /** SSOT מ-getCustomerOpenDebt — זהה לכרטסת / יתרות (כולל משיכות מחוב); null = לא נטען */
  const [customerLedgerChargesUsd, setCustomerLedgerChargesUsd] = useState<number | null>(null);
  const [customerLedgerPaymentsUsd, setCustomerLedgerPaymentsUsd] = useState<number | null>(null);
  const [customerLedgerWithdrawalsUsd, setCustomerLedgerWithdrawalsUsd] = useState<number | null>(null);
  const [serverCommissionBalanceUsd, setServerCommissionBalanceUsd] = useState(0);
  const [serverCreditBalanceUsd, setServerCreditBalanceUsd] = useState(0);
  const [commissionPopoverOpen, setCommissionPopoverOpen] = useState(false);
  const [orderCommissionDetail, setOrderCommissionDetail] = useState<{
    orderId: string;
    orderNumber: string | null;
    baseCommissionUsd: number;
    adjustmentsUsd: number;
    currentCommissionUsd: number;
  } | null>(null);
  const [creditPopoverOpen, setCreditPopoverOpen] = useState(false);
  const customerOpenDebtFetchGenRef = useRef(0);
  const [commissionResetTarget, setCommissionResetTarget] = useState<{
    orderId: string;
    orderNumber: string | null;
    oldCommissionUsd: number;
    remainingUsd: number;
    newCommissionUsd: number;
  } | null>(null);

  const customerIdRef = useRef<string | null>(null);
  customerIdRef.current = customer?.id ?? null;
  customerHitsRef.current = customerHits;
  custActiveIndexRef.current = custActiveIndex;
  selectedCustomerRef.current = customer
    ? { id: customer.id, code: customer.customerCode ?? null }
    : null;

  const paymentEntryCacheRef = useRef<Map<string, PaymentEntryResponse>>(new Map());
  const customerHydrateCacheRef = useRef<Map<string, PaymentCustomerHydrateCache>>(new Map());
  const paymentSnapshotCacheRef = useRef(getSharedPaymentSnapshotCache());
  const buildSnapshotRef = useRef<(() => PaymentCaptureSnapshot | null) | null>(null);
  const savedCapturePaymentIdRef = useRef<string | null>(null);
  const displayedPaymentCodeRef = useRef("");
  const [paymentCodeSearch, setPaymentCodeSearch] = useState("");
  const [paymentCodeSearchBusy, setPaymentCodeSearchBusy] = useState(false);
  const paymentHydrateGenRef = useRef(0);

  const initialAppliedRef = useRef(false);

  const rateN = parseNum(dollarRate);

  const totals = useMemo(() => calculateTotals(payments, rateN, DEFAULT_VAT_RATE), [payments, rateN]);

  const savedPaymentIdForMode = loadedPayment?.id?.trim();
  const isExistingPaymentEarly = Boolean(
    savedPaymentIdForMode && savedPaymentIdForMode !== NEW_CAPTURE_ROW_ID,
  );

  const paymentApplyUsd = useMemo(
    () =>
      computePaymentIntakeApplyUsd({
        isExistingPayment: isExistingPaymentEarly,
        formTotalUsd: totals.totalUsd,
        savedBaselineTotalUsd: savedBaselinePaymentTotalUsd,
      }),
    [isExistingPaymentEarly, totals.totalUsd, savedBaselinePaymentTotalUsd],
  );

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

  /**
   * אמצעי תשלום מתוכננים הם להמלצה/בקרה בלבד — לא לנעילה.
   * בעולם האמיתי לקוחות משנים אמצעי תשלום (לדוגמה תכננו העברה ושילמו אשראי),
   * ולכן אין להגביל את הבחירה. חריגה (planned != actual) תסומן ותתועד בנפרד.
   */
  const allowedMethods = null;

  const customerBalanceResetPreview = useMemo((): CommissionResetOrderPreview[] => {
    if (!customerBalanceResetPending) return [];
    const allocated = allocatePaymentAcrossOrders(
      toPaymentIntakeBases(orders),
      paymentApplyUsd,
      prioritizedSet,
    );
    const allocPairs = [...allocated.byOrderId.entries()].filter(([, amountUsd]) => amountUsd > BALANCE_RESET_TOLERANCE_USD);
    const lastAllocOrderId = allocPairs.length > 0 ? allocPairs[allocPairs.length - 1][0] : null;
    return computeOrderBalanceResetRows({
      orders: orders.map((o) => ({
        id: o.id,
        totalAmountUsd: Number(o.totalAmountUsd) || 0,
        dbPaidUsd: Number(o.dbPaidUsd) || 0,
        commissionUsd: Number(o.commissionUsd) || 0,
      })),
      allocationByOrderId: allocated.byOrderId,
      unallocatedUsd: allocated.unallocatedUsd,
      lastAllocatedOrderId: lastAllocOrderId,
    }).map((row) => ({
      id: row.orderId,
      totalAmountUsd: row.totalBeforeUsd,
      dbPaidUsd: row.paidUsd,
      commissionUsd: row.commissionBeforeUsd,
    }));
  }, [customerBalanceResetPending, orders, paymentApplyUsd, prioritizedSet]);

  const orderBalanceResetSummary = useMemo(() => {
    const allocated = allocatePaymentAcrossOrders(
      toPaymentIntakeBases(orders),
      paymentApplyUsd,
      prioritizedSet,
    );
    const allocPairs = [...allocated.byOrderId.entries()].filter(([, amountUsd]) => amountUsd > BALANCE_RESET_TOLERANCE_USD);
    const lastAllocOrderId = allocPairs.length > 0 ? allocPairs[allocPairs.length - 1][0] : null;
    const rows = computeOrderBalanceResetRows({
      orders: orders.map((o) => ({
        id: o.id,
        totalAmountUsd: Number(o.totalAmountUsd) || 0,
        dbPaidUsd: Number(o.dbPaidUsd) || 0,
        commissionUsd: Number(o.commissionUsd) || 0,
      })),
      allocationByOrderId: allocated.byOrderId,
      unallocatedUsd: allocated.unallocatedUsd,
      lastAllocatedOrderId: lastAllocOrderId,
    });
    return summarizeOrderBalanceResetRows(rows);
  }, [orders, paymentApplyUsd, prioritizedSet]);

  const matched = useMemo(() => {
    return matchPaymentToOrders(bases, paymentApplyUsd, prioritizedSet);
  }, [bases, paymentApplyUsd, prioritizedSet]);

  /** שבוע עבודה / קליטה — מהבורר בלבד */
  const intakeWeekCode = useMemo(() => {
    return normalizeAhWeekCode(weekDraft.trim()) ?? DEFAULT_WEEK_CODE;
  }, [weekDraft]);

  /** שבוע מקור ההזמנות — שבוע קודם לקליטה, או לפי תאריך מקור ידני */
  const orderSourceWeekCode = useMemo(() => {
    return (
      weekCodeForPaymentIntakeOrders(intakeWeekCode, orderSourceDateYmd) ??
      resolveOrderSourceWeekCode(intakeWeekCode) ??
      intakeWeekCode
    );
  }, [intakeWeekCode, orderSourceDateYmd]);

  /** קליטה שמורה ב־DB — מקור הניווט היחיד לרשומות Payment Entry */
  const savedCapturePaymentId = useMemo(() => {
    const id = loadedPayment?.id?.trim();
    if (!id || id === NEW_CAPTURE_ROW_ID) return null;
    return id;
  }, [loadedPayment?.id]);

  // מסמכים מצורפים: תשלום חדש מעלה תחת מפתח טיוטה ומקושר ל-paymentId האמיתי בשמירה.
  const [docDraftKey, setDocDraftKey] = useState<string>(() => makeDocDraftKey());
  const docDraftKeyRef = useRef(docDraftKey);
  docDraftKeyRef.current = docDraftKey;
  const docEntityId = savedCapturePaymentId ?? docDraftKey;

  const isExistingPayment = isExistingSavedPayment(savedCapturePaymentId);

  const isHistoricalPaymentView =
    isExistingPayment && isExistingPaymentUnchanged(paymentApplyUsd) && !customerBalanceResetPending;

  // החלפת לקוח בתשלום חדש — מאפס את אזור המסמכים כדי לא לקשר טיוטה ללקוח אחר.
  useEffect(() => {
    if (!savedCapturePaymentId) setDocDraftKey(makeDocDraftKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  const displayedPaymentCode = useMemo(() => {
    const id = loadedPayment?.id?.trim();
    if (id && id !== NEW_CAPTURE_ROW_ID) {
      return (loadedPayment?.paymentCode ?? "").trim();
    }
    return (previewPaymentCode ?? "").trim();
  }, [loadedPayment?.id, loadedPayment?.paymentCode, previewPaymentCode]);

  savedCapturePaymentIdRef.current = savedCapturePaymentId;
  displayedPaymentCodeRef.current = displayedPaymentCode;

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
    return WORK_WEEK_RANGES[intakeWeekCode] ? intakeWeekCode : DEFAULT_WEEK_CODE;
  }, [intakeWeekCode]);

  const ordersCountryBadge = useMemo(() => countryBadgeFromOrders(orders), [orders]);

  const countryBadgeDisplay = useMemo(() => {
    if (countryOverride !== "AUTO") return COUNTRY_BADGE_SHORT[countryOverride];
    return ordersCountryBadge;
  }, [countryOverride, ordersCountryBadge]);

  /** מדינת מסמך הקליטה — קוד תשלום / בורר / URL (לא מהזמנות מעורבות בטבלה) */
  const intakeDocumentWorkCountry = useMemo(
    (): WorkCountryCode =>
      paymentIntakeTableWorkCountry(countryOverride, displayedPaymentCode, globalCountry),
    [countryOverride, displayedPaymentCode, globalCountry],
  );

  /** מדינת קליטה להקצאת קוד חדש — מהזמנות / בורר מדינה */
  const captureWorkCountry = useMemo((): WorkCountryCode => {
    if (countryOverride !== "AUTO") return workCountryFromOrderSourceCountry(countryOverride);
    for (const o of orders) {
      if (o.sourceCountry) return workCountryFromOrderSourceCountry(o.sourceCountry);
    }
    return workCountryFromOrderSourceCountry(globalCountry);
  }, [countryOverride, orders, globalCountry]);

  const refreshCustomerOpenDebt = useCallback(async (customerId: string) => {
    const cid = customerId.trim();
    if (!cid) {
      setCustomerOpenDebtSignedUsd(null);
      setCustomerLedgerChargesUsd(null);
      setCustomerLedgerPaymentsUsd(null);
      setCustomerLedgerWithdrawalsUsd(null);
      return;
    }
    const gen = ++customerOpenDebtFetchGenRef.current;
    const res = await fetchCustomerOpenDebtAction(cid, intakeDocumentWorkCountry);
    if (gen !== customerOpenDebtFetchGenRef.current) return;
    if (res.ok) {
      setCustomerOpenDebtSignedUsd(parseMoneyStringOrZero(res.openDebtUsd));
      setCustomerLedgerChargesUsd(parseMoneyStringOrZero(res.totalOrdersBeforeCommissionUsd));
      setCustomerLedgerPaymentsUsd(parseMoneyStringOrZero(res.totalPaymentsUsd));
      setCustomerLedgerWithdrawalsUsd(parseMoneyStringOrZero(res.totalWithdrawalsUsd));
      setServerCreditBalanceUsd(parseMoneyStringOrZero(res.customerCreditUsd));
      setServerCommissionBalanceUsd(parseMoneyStringOrZero(res.feeBalanceUsd));
      setCustomer((cur) =>
        cur?.id === cid ? { ...cur, customerBalanceUsd: res.internalSignedUsd } : cur,
      );
    }
  }, [intakeDocumentWorkCountry]);

  useEffect(() => {
    if (!customer?.id?.trim()) {
      setCustomerOpenDebtSignedUsd(null);
      setCustomerLedgerChargesUsd(null);
      setCustomerLedgerPaymentsUsd(null);
      setCustomerLedgerWithdrawalsUsd(null);
    }
  }, [customer?.id]);

  useEffect(() => {
    const onBalancesRefresh = () => {
      const cid = customer?.id?.trim();
      if (cid) void refreshCustomerOpenDebt(cid);
    };
    window.addEventListener("wego:balances-refresh", onBalancesRefresh);
    return () => window.removeEventListener("wego:balances-refresh", onBalancesRefresh);
  }, [customer?.id, refreshCustomerOpenDebt]);

  const customerWorkspaceLoading =
    loadingCustomer || ordersLoading || balancesLoading || paymentsLoading;

  const customerBalanceUsd = useMemo(
    () => parseMoneyStringOrZero(customer?.customerBalanceUsd ?? "0"),
    [customer?.customerBalanceUsd],
  );
  const customerOpenDebtDisplayUsd = paymentIntakeCustomerOpenDebtUsd({
    customerOpenDebtSignedUsd,
    customerBalanceResetPending,
  });
  /** נשאר לתשלום לשבוע הנבחר — אותו יקום כמו טבלת ההזמנות. לא CURRENT SSOT. */
  const weekScopedRemainingUsd = useMemo(
    () =>
      customerBalanceResetPending ? 0 : sumPaymentIntakeWeekScopedRemainingUsd(orders),
    [customerBalanceResetPending, orders],
  );

  /** יתרה שנותרת על הזמנות לאחר הקצאת התשלום הנוכחי (חוסר בלבד — תאימות לאחור) */
  const orderRemainderAfterPaymentUsd = useMemo(() => {
    return roundMoney2(orderBalanceResetSummary.totalShortfallUsd);
  }, [orderBalanceResetSummary.totalShortfallUsd]);

  const orderOverpaymentAfterPaymentUsd = useMemo(() => {
    return roundMoney2(orderBalanceResetSummary.totalOverpaymentUsd);
  }, [orderBalanceResetSummary.totalOverpaymentUsd]);

  const hasOrderPaymentDifference = orderBalanceResetSummary.hasEligibleDifference;

  const customerBalanceResetPreviewForLive = useMemo(
    () => (customerBalanceResetPending && !balanceResetFromCredit ? customerBalanceResetPreview : []),
    [customerBalanceResetPending, balanceResetFromCredit, customerBalanceResetPreview],
  );
  /** מחשבון עסקי חי — חיובים / עמלות / תשלומים / יתרה (כולל תשלום בטופס + איפוס עמלה) */
  const liveIntakeTotals = useMemo(
    () =>
      computePaymentIntakeLiveTotals({
        orders: toPaymentIntakeBases(orders),
        commissionResetOrderIds: commissionResetIds,
        commissionResetPreview,
        customerBalanceResetPreview: customerBalanceResetPreviewForLive,
        customerPaymentsUsd: sumCustomerPaymentsUsd(customerPayments),
        formPaymentUsd: totals.totalUsd,
        customerSignedOpenDebtUsd: customerOpenDebtSignedUsd,
        customerApplyPaymentUsd: paymentApplyUsd,
        customerTotalChargesUsd: customerLedgerChargesUsd,
        customerTotalPaymentsUsd: customerLedgerPaymentsUsd,
        customerTotalWithdrawalsUsd: customerLedgerWithdrawalsUsd,
      }),
    [
      orders,
      commissionResetIds,
      commissionResetPreview,
      customerBalanceResetPreviewForLive,
      customerPayments,
      totals.totalUsd,
      customerOpenDebtSignedUsd,
      paymentApplyUsd,
      customerLedgerChargesUsd,
      customerLedgerPaymentsUsd,
      customerLedgerWithdrawalsUsd,
    ],
  );

  const pendingCommissionDebitUsd = useMemo(() => {
    let debit = 0;
    if (customerBalanceResetPending && !balanceResetFromCredit) {
      debit += orderBalanceResetSummary.totalShortfallUsd;
    }
    if (commissionResetIds.length > 0) {
      const reset = new Set(commissionResetIds);
      for (const o of orders) {
        if (!reset.has(o.id)) continue;
        const plan = planCommissionDebtClosureFromNumbers({
          commissionUsd: Number(o.commissionUsd) || 0,
          totalUsd: Number(o.totalAmountUsd) || 0,
          paidUsd: Number(o.dbPaidUsd) || 0,
        });
        debit += Math.max(0, plan.remainingUsd);
      }
    }
    return roundMoney2(debit);
  }, [
    customerBalanceResetPending,
    balanceResetFromCredit,
    orderBalanceResetSummary.totalShortfallUsd,
    commissionResetIds,
    orders,
  ]);

  /** יתרת עמלה — SSOT מהשרת + תצוגת דельת איפוס לפני שמירה */
  const displayCommissionBalanceUsd = useMemo(
    () =>
      computePaymentIntakeCommissionDisplayUsd({
        serverCommissionBalanceUsd,
        pendingDebitFromCommissionUsd: pendingCommissionDebitUsd,
        pendingCreditToCommissionUsd: 0,
      }),
    [serverCommissionBalanceUsd, pendingCommissionDebitUsd],
  );

  const displayCreditBalanceUsd = useMemo(
    () => roundMoney2(serverCreditBalanceUsd),
    [serverCreditBalanceUsd],
  );
  const customerHasCredit = displayCreditBalanceUsd > 0.01;
  const customerFinancial = useMemo(
    () =>
      buildCustomerFinancialState({
        openDebtUsd: customerOpenDebtDisplayUsd,
        availableCreditUsd: displayCreditBalanceUsd,
        commissionBalanceUsd: displayCommissionBalanceUsd,
      }),
    [customerOpenDebtDisplayUsd, displayCreditBalanceUsd, displayCommissionBalanceUsd],
  );

  const creditAvailableForResetUsd = useMemo(
    () => (displayCreditBalanceUsd > 0.01 ? roundMoney2(displayCreditBalanceUsd) : 0),
    [displayCreditBalanceUsd],
  );

  const eligibleCreditCoverUsd = useMemo(() => {
    if (isHistoricalPaymentView) return 0;
    const draftPay = isExistingPayment
      ? Math.max(0, paymentApplyUsd)
      : Math.max(0, totals.totalUsd);
    return roundMoney2(Math.max(0, weekScopedRemainingUsd - draftPay));
  }, [
    isHistoricalPaymentView,
    isExistingPayment,
    paymentApplyUsd,
    totals.totalUsd,
    weekScopedRemainingUsd,
  ]);

  const pendingCreditApplyUsd = useMemo(
    () =>
      computePendingCreditApplyUsd({
        availableCreditUsd: creditAvailableForResetUsd,
        eligibleAmountToPayUsd: eligibleCreditCoverUsd,
        useExistingCredit: balanceResetFromCredit,
      }),
    [creditAvailableForResetUsd, eligibleCreditCoverUsd, balanceResetFromCredit],
  );

  const canUseExistingCredit =
    !isHistoricalPaymentView &&
    creditAvailableForResetUsd > 0.01 &&
    eligibleCreditCoverUsd > 0.01;

  const displayCreditBalanceAfterApplyUsd = useMemo(() => {
    if (pendingCreditApplyUsd <= 0.01) return displayCreditBalanceUsd;
    return roundMoney2(Math.max(0, displayCreditBalanceUsd - pendingCreditApplyUsd));
  }, [displayCreditBalanceUsd, pendingCreditApplyUsd]);

  const remainderAfterCreditApplyUsd = useMemo(() => {
    if (pendingCreditApplyUsd <= 0.01) return eligibleCreditCoverUsd;
    return roundMoney2(Math.max(0, eligibleCreditCoverUsd - pendingCreditApplyUsd));
  }, [eligibleCreditCoverUsd, pendingCreditApplyUsd]);

  /** מחשבון חי — רק שורות התשלום בטופס (onChange) */
  const liveFormKpis = useMemo(
    () => aggregateLivePaymentFormKpis(payments, rateN),
    [payments, rateN],
  );

  /**
   * מקור תצוגה משותף: כפתור בקרה + גריד החלון נגזרים מאותו `orders` + KPIs
   * (SSOT) — בלי חישוב נפרד בתוך המודאל.
   */
  const {
    methodControlRows,
    methodViews,
    orderViews,
    showMethodControl,
  } = usePaymentIntakePlanningViews(orders, includedIds, liveFormKpis, paymentApplyUsd);

  /** בדיקות חריגה/יתרה חיות — לתצוגה בלבד (לא רק בזמן שמירה) */
  const liveIntakeDevRows = useMemo(() => {
    if (!customer || (isHistoricalPaymentView ? false : paymentApplyUsd <= 0.005)) return [];
    return computeIntakeSaveDeviations({
      orders,
      includedOrderIds: includedIds,
      enteredByBucket: buildEnteredByBucket(liveFormKpis),
      formRateN: rateN,
      totalPaymentUsd: paymentApplyUsd,
    });
  }, [customer, orders, includedIds, liveFormKpis, rateN, paymentApplyUsd, isHistoricalPaymentView]);

  const hasMethodMismatchLive = useMemo(
    () => intakeHasMethodMismatch(liveIntakeDevRows),
    [liveIntakeDevRows],
  );
  const hasRateMismatchLive = useMemo(
    () => intakeHasRateMismatch(liveIntakeDevRows),
    [liveIntakeDevRows],
  );
  const hasOpenBalanceShortfallLive = useMemo(
    () => intakeHasOpenBalanceShortfall(liveIntakeDevRows),
    [liveIntakeDevRows],
  );

  /** אמצעי תואם + נשאר סכום קטן — לא חריגה, מציעים טיפול ביתרה */
  const showOpenBalanceActions = useMemo(() => {
    if (!customer || customerBalanceResetPending || isHistoricalPaymentView) return false;
    if (hasMethodMismatchLive || hasRateMismatchLive) return false;
    return hasOrderPaymentDifference || hasOpenBalanceShortfallLive;
  }, [
    customer,
    customerBalanceResetPending,
    hasMethodMismatchLive,
    hasRateMismatchLive,
    hasOrderPaymentDifference,
    hasOpenBalanceShortfallLive,
    isHistoricalPaymentView,
  ]);

  const totalDebtBeforePaymentUsd = weekScopedRemainingUsd;

  const paymentPreview = useMemo(
    () =>
      buildPaymentPreview({
        financialState: {
          openDebtUsd: weekScopedRemainingUsd,
          availableCreditUsd: displayCreditBalanceUsd,
          commissionBalanceUsd: displayCommissionBalanceUsd,
        },
        draftPaymentUsd: isHistoricalPaymentView
          ? 0
          : isExistingPayment
            ? Math.max(0, paymentApplyUsd)
            : Math.max(0, totals.totalUsd),
        selectedOrders: customerBalanceResetPending ? [] : toPaymentPreviewOrders(orders),
        selectedOrdersRemainingUsd: customerBalanceResetPending ? 0 : undefined,
        useExistingCredit: pendingCreditApplyUsd > 0.01,
      }),
    [
      customerBalanceResetPending,
      weekScopedRemainingUsd,
      displayCreditBalanceUsd,
      displayCommissionBalanceUsd,
      isHistoricalPaymentView,
      isExistingPayment,
      paymentApplyUsd,
      totals.totalUsd,
      orders,
      pendingCreditApplyUsd,
    ],
  );

  const paymentBalanceDisplay = useMemo((): PaymentBalanceDisplay => {
    return remainingToPayCardDisplayFromPreview(paymentPreview, rateN);
  }, [paymentPreview, rateN]);

  const accountStatusDisplay = paymentBalanceDisplay;

  /** תצוגה חיה — יתרה לאחר הקצאת התשלום (חתום: שלילי = עודף) */
  const openDebtAfterPaymentPreview = useMemo(() => {
    const currentOpenBalance = totalDebtBeforePaymentUsd;
    const enteredPaymentAmount = isHistoricalPaymentView
      ? 0
      : isExistingPayment
        ? roundMoney2(paymentApplyUsd)
        : roundMoney2(totals.totalUsd);
    const remainingAfterPayment = paymentPreview.signedRemainingUsd;
    let openCommissionUsd = 0;
    for (const o of orders) {
      const rem = Number.isFinite(Number(o.dbRemainingUsd))
        ? Math.max(0, Number(o.dbRemainingUsd))
        : computeOrderOpenDebtUsd(Number(o.totalAmountUsd), Number(o.dbPaidUsd));
      if (rem <= 0.01) continue;
      openCommissionUsd += Number(o.commissionUsd) || 0;
    }
    openCommissionUsd = roundMoney2(openCommissionUsd);
    const afterCommissionUsd = roundMoney2(
      openCommissionUsd - Math.max(0, remainingAfterPayment),
    );
    return {
      currentOpenBalance,
      enteredPaymentAmount,
      remainingAfterPayment,
      paymentBalanceDisplay: accountStatusDisplay,
      openCommissionUsd,
      afterCommissionUsd,
    };
  }, [
    totalDebtBeforePaymentUsd,
    totals.totalUsd,
    paymentApplyUsd,
    isExistingPayment,
    isHistoricalPaymentView,
    paymentPreview.signedRemainingUsd,
    paymentBalanceDisplay,
    accountStatusDisplay,
    orders,
  ]);

  const intakeStripOpenDebtUsd = customerOpenDebtDisplayUsd;

  /**
   * שורות חוסמות לתצוגה — אמצעי / שער.
   * תשלום יתר (payment > openDebt) מטופל רק בחלון «התקבל תשלום יתר».
   * אין להציג באנר «נדרש עדכון חלוקת אמצעי תשלום» על excess במצב עודף.
   * חשוב: להשתמש ב-SSOT של יתרת התשלום (paymentBalance), לא בסיכום איפוס יתרה.
   */
  const intakeCorrectionRows = useMemo(
    () => filterIntakeCorrectionRowsForDisplay(liveIntakeDevRows, paymentBalanceDisplay.state),
    [liveIntakeDevRows, paymentBalanceDisplay.state],
  );

  const intakeDeviationViewLive = useMemo<IntakeDeviationModalView | null>(() => {
    const modalRows = intakeDeviationModalRows(
      intakeDevRows.length > 0 ? intakeDevRows : liveIntakeDevRows,
    );
    if (modalRows.length === 0) return null;
    const kpis = liveFormKpis;
    return buildIntakeDeviationModalView({
      orders,
      includedOrderIds: includedIds,
      enteredByBucket: buildEnteredByBucket(kpis),
      totalPaymentUsd: paymentApplyUsd,
      devRows: modalRows,
      formRateN: rateN,
      enteredIlsByBucket: {
        CASH: kpis.cash.enteredIls,
        BANK_TRANSFER: kpis.bankTransfer.enteredIls,
        CREDIT: kpis.credit.enteredIls,
        CHECK: kpis.checks.enteredIls,
        OTHER: kpis.other.enteredIls,
      },
    });
  }, [intakeDevRows, liveIntakeDevRows, orders, includedIds, liveFormKpis, paymentApplyUsd, rateN]);

  const canApplyResetCustomerBalance = useMemo(() => {
    if (customerBalanceResetPending) return true;
    return hasOrderPaymentDifference;
  }, [customerBalanceResetPending, hasOrderPaymentDifference]);

  const showResetBalanceBtn = useMemo(() => {
    if (!viewerIsAdmin || !customer) return false;
    return showOpenBalanceActions || customerBalanceResetPending;
  }, [viewerIsAdmin, customer, showOpenBalanceActions, customerBalanceResetPending]);

  const showCreditBalanceResetBtn = useMemo(() => {
    if (!viewerIsAdmin || !customer) return false;
    if (customerBalanceResetPending && balanceResetFromCredit) return false;
    if (orderOverpaymentAfterPaymentUsd > 0.01) return false;
    return (
      showOpenBalanceActions &&
      creditAvailableForResetUsd > 0.01 &&
      orderRemainderAfterPaymentUsd > 0.01
    );
  }, [
    viewerIsAdmin,
    customer,
    showOpenBalanceActions,
    creditAvailableForResetUsd,
    orderRemainderAfterPaymentUsd,
    orderOverpaymentAfterPaymentUsd,
    customerBalanceResetPending,
    balanceResetFromCredit,
  ]);

  const showInlineShortfallResetBtn = useMemo(() => {
    if (!customer || customerWorkspaceLoading) return false;
    if (intakeCorrectionRows.length > 0) return false;
    if (orderRemainderAfterPaymentUsd <= 0.01) return false;
    if (orderOverpaymentAfterPaymentUsd > 0.01) return false;
    return orderBalanceResetSummary.totalShortfallUsd > 0.01;
  }, [
    customer,
    customerWorkspaceLoading,
    intakeCorrectionRows.length,
    orderRemainderAfterPaymentUsd,
    orderOverpaymentAfterPaymentUsd,
    orderBalanceResetSummary.totalShortfallUsd,
  ]);

  const showInlineOverpaymentBtn = useMemo(() => {
    if (!customer || customerWorkspaceLoading) return false;
    // חריגת שער עדיין חוסמת; excess על עודף תשלום כבר סונן מ-intakeCorrectionRows
    if (intakeCorrectionRows.some((r) => r.rowTone === "rate")) return false;
    // SSOT: חוב לקוח מול התשלום הנוכחי — לא סיכום איפוס הזמנות בלבד
    return (
      paymentBalanceDisplay.state === "surplus" ||
      computePaymentOverpayment(
        totalDebtBeforePaymentUsd,
        isHistoricalPaymentView
          ? 0
          : isExistingPayment
            ? paymentApplyUsd
            : totals.totalUsd,
      ).hasOverpayment
    );
  }, [
    customer,
    customerWorkspaceLoading,
    intakeCorrectionRows,
    paymentBalanceDisplay.state,
    totalDebtBeforePaymentUsd,
    isHistoricalPaymentView,
    isExistingPayment,
    paymentApplyUsd,
    totals.totalUsd,
  ]);

  const paymentCaptureIsDirty = useCallback(
    () => baselineSigRef.current !== "" && baselineSigRef.current !== currentDraftSig,
    [currentDraftSig],
  );

  const cachePaymentEntry = useCallback((entry: PaymentEntryResponse) => {
    const snap = clonePaymentEntry(entry);
    const code = snap.paymentCode?.trim().toUpperCase();
    if (code) paymentEntryCacheRef.current.set(code, snap);
    const id = snap.id?.trim();
    if (id && id !== NEW_CAPTURE_ROW_ID) paymentEntryCacheRef.current.set(id, snap);
    cacheSharedPaymentEntry(snap);
  }, []);

  const clearPaymentEntryCaches = useCallback(() => {
    paymentEntryCacheRef.current.clear();
    customerHydrateCacheRef.current.clear();
  }, []);

  const scrollToPaymentLineIndex = useCallback((index: number) => {
    setActivePaymentLineIndex(index);
    window.requestAnimationFrame(() => {
      const container = paymentLinesContainerRef.current;
      const el = container?.children[index] as HTMLElement | undefined;
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  useEffect(() => {
    setActivePaymentLineIndex((i) => Math.min(i, Math.max(0, payments.length - 1)));
  }, [payments.length]);

  const prefetchCustomerHydrateForEntry = useCallback((entry: PaymentEntryResponse) => {
    const customerId = entry.customer.id?.trim();
    if (!customerId) return;
    const intakeWeek = intakeWeekFromPaymentEntry(entry);
    const week = orderSourceWeekForIntakeWeek(intakeWeek);
    const wc = paymentIntakeTableWorkCountry(
      countryOverride,
      (entry.paymentCode ?? "").trim(),
      globalCountry,
    );
    const key = paymentCustomerHydrateKey(customerId, week, wc);
    if (customerHydrateCacheRef.current.has(key)) return;
    void fetchPaymentIntakeCustomerOrdersAction(customerId, week, wc).then((res) => {
      if (!res.ok) return;
      customerHydrateCacheRef.current.set(key, {
        customer: res.customer,
        orders: res.orders,
        customerPayments: res.customerPayments,
      });
    });
  }, [countryOverride, globalCountry]);

  const refreshPaymentCodePreview = useCallback(() => {
    setPaymentCodePreviewPending(true);
    void previewPaymentCodeForCaptureAction({
      customerId: customer?.id,
      workCountry: captureWorkCountry,
    }).then((pr) => {
      setPaymentCodePreviewPending(false);
      if (pr.ok) {
        setPreviewPaymentCode(pr.code);
        setSaveErr(null);
      } else {
        setPreviewPaymentCode(null);
        setSaveErr(pr.error);
      }
    });
  }, [customer?.id, captureWorkCountry]);

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

  const loadCustomerWorkspaceInBackground = useCallback(
    (
      customerId: string,
      weekCode?: string | null,
      opts?: { perfLabel?: string; cacheSnapshotPaymentId?: string },
    ): Promise<void> => {
      const cid = customerId.trim();
      if (!cid) return Promise.resolve();

      const gen = ++customerWorkspaceGenRef.current;
      const weekForFetch =
        weekCode?.trim() ||
        orderSourceWeekForIntakeWeek(intakeWeekCode, orderSourceDateYmd);
      const wc = intakeDocumentWorkCountry;
      const bgStart = performance.now();

      setOrdersLoading(true);
      setBalancesLoading(true);
      setPaymentsLoading(true);
      setLoadErr(null);

      const ordersStart = performance.now();
      const balancesStart = performance.now();
      const paymentsStart = performance.now();

      // orders + balances + payments — במקביל (Promise.all), לא ברצף
      const ordersP = fetchPaymentIntakeOrdersClient(cid, weekForFetch, wc).then((res) => {
        const ordersLoadMs = Math.round(performance.now() - ordersStart);
        if (gen !== customerWorkspaceGenRef.current) return { ordersLoadMs, ok: true as const };
        setOrdersLoading(false);
        if (!res.ok) {
          setLoadErr(res.error);
          return { ordersLoadMs, ok: false as const };
        }
        setOrders(res.orders);
        setCommissionResetIds([]);
        setCustomerBalanceResetPending(false);
        setBalanceResetFromCredit(false);
        setIncludedIds(null);
        return { ordersLoadMs, ok: true as const };
      });

      const balancesP = fetchPaymentIntakeBalancesClient(cid, wc).then((res) => {
        const balancesLoadMs = Math.round(performance.now() - balancesStart);
        if (gen !== customerWorkspaceGenRef.current) return { balancesLoadMs, ok: true as const };
        setBalancesLoading(false);
        if (!res.ok) return { balancesLoadMs, ok: false as const };
        setCustomerOpenDebtSignedUsd(parseMoneyStringOrZero(String(res.openDebtSignedUsd)));
        setCustomerLedgerChargesUsd(Number(res.totalOrdersBeforeCommissionUsd) || 0);
        setCustomerLedgerPaymentsUsd(Number(res.totalPaymentsUsd) || 0);
        setCustomerLedgerWithdrawalsUsd(Number(res.totalWithdrawalsUsd) || 0);
        setServerCommissionBalanceUsd(Number(res.commissionBalanceUsd) || 0);
        setServerCreditBalanceUsd(Number(res.creditBalanceUsd) || 0);
        setCustomer((cur) =>
          cur?.id === cid
            ? { ...cur, customerBalanceUsd: res.internalSignedUsd || res.customerBalanceUsd }
            : cur,
        );
        return { balancesLoadMs, ok: true as const };
      });

      const paymentsP = fetchPaymentIntakeCustomerPaymentsClient(cid, wc).then((res) => {
        const paymentsLoadMs = Math.round(performance.now() - paymentsStart);
        if (gen !== customerWorkspaceGenRef.current) return { paymentsLoadMs, ok: true as const };
        setPaymentsLoading(false);
        if (!res.ok) return { paymentsLoadMs, ok: false as const };
        setCustomerPayments(res.customerPayments);
        return { paymentsLoadMs, ok: true as const };
      });

      return Promise.all([ordersP, balancesP, paymentsP]).then(([ordersRes, balancesRes, paymentsRes]) => {
        if (gen !== customerWorkspaceGenRef.current) return;
        const customerFoundMs = customerSearchPerfRef.current ?? undefined;
        customerSearchPerfRef.current = null;

        const cachePid = opts?.cacheSnapshotPaymentId?.trim();
        if (cachePid) {
          const snap = buildSnapshotRef.current?.();
          if (snap && snap.paymentId === cachePid) {
            paymentSnapshotCacheRef.current.set(snap);
            cacheSharedPaymentSnapshot(snap);
          }
        }

        const ordersMs = ordersRes.ordersLoadMs;
        const balancesMs = balancesRes.balancesLoadMs;
        const customerPaymentsMs = paymentsRes.paymentsLoadMs;
        const totalCustomerLoadMs = Math.round(performance.now() - bgStart);
        logPaymentCapturePerf({
          label: opts?.perfLabel ?? "customerWorkspaceBackground",
          customerFoundMs,
          ordersMs,
          balancesMs,
          customerPaymentsMs,
          totalCustomerLoadMs,
          ordersLoadMs: ordersMs,
          loadOrdersMs: ordersMs,
          balancesLoadMs: balancesMs,
          loadBalancesMs: balancesMs,
          paymentsLoadMs: customerPaymentsMs,
          renderMs: totalCustomerLoadMs,
        });
      });
    },
    [intakeDocumentWorkCountry, intakeWeekCode, orderSourceDateYmd],
  );

  const loadCustomerOrders = useCallback(
    async (customerId: string, opts?: { silent?: boolean; focusAmount?: boolean; weekCode?: string }): Promise<boolean> => {
      const cid = customerId.trim();
      if (!cid) return false;

      if (opts?.silent) {
        loadCustomerWorkspaceInBackground(cid, opts.weekCode);
        if (opts?.focusAmount === true) focusFirstAmountInput();
        setCustSearchNoHits(false);
        setSaveErr(null);
        return true;
      }

      setLoadingCustomer(true);
      setOrdersLoading(true);
      setBalancesLoading(true);
      setPaymentsLoading(true);
      setLoadErr(null);
      const weekForFetch =
        opts?.weekCode?.trim() ||
        orderSourceWeekForIntakeWeek(intakeWeekCode, orderSourceDateYmd);
      const wc = intakeDocumentWorkCountry;
      const loadStart = performance.now();
      const workspaceStart = performance.now();
      const balancesStart = performance.now();

      const [workspaceRes, balancesRes] = await Promise.all([
        fetchPaymentIntakeCustomerOrdersAction(cid, weekForFetch, wc).then((r) => ({
          res: r,
          ms: Math.round(performance.now() - workspaceStart),
        })),
        fetchPaymentIntakeBalancesClient(cid, wc).then((r) => ({
          res: r,
          ms: Math.round(performance.now() - balancesStart),
        })),
      ]);

      setLoadingCustomer(false);
      setOrdersLoading(false);
      setBalancesLoading(false);
      setPaymentsLoading(false);

      const totalCustomerLoadMs = Math.round(performance.now() - loadStart);
      const workspace = workspaceRes.res;
      const balances = balancesRes.res;

      if (!workspace.ok) {
        setCustomer(null);
        setCustomerPayments([]);
        setOrders([]);
        setCommissionResetIds([]);
        setCustomerBalanceResetPending(false);
        setBalanceResetFromCredit(false);
        setLoadErr(workspace.error);
        logPaymentCapturePerf({
          label: "customerWorkspaceAwait",
          totalCustomerLoadMs,
          ordersMs: workspaceRes.ms,
        });
        return false;
      }

      setCustomer(workspace.customer);
      setCustomerPayments(workspace.customerPayments);
      setOrders(workspace.orders);
      setCommissionResetIds([]);
      setCustomerBalanceResetPending(false);
      setBalanceResetFromCredit(false);
      setDraftCustomer({
        code: workspace.customer.customerCode ?? "",
        displayName: workspace.customer.displayName ?? "",
        nameEn: workspace.customer.nameEn ?? workspace.customer.nameHe ?? "",
        nameAr: workspace.customer.nameAr ?? "",
        phone: workspace.customer.phone ?? "",
        index: workspace.customer.customerIndex ?? "",
      });
      setIncludedIds(null);
      setSaveErr(null);
      setCustSearchNoHits(false);
      if (balances.ok) {
        setCustomerOpenDebtSignedUsd(parseMoneyStringOrZero(String(balances.openDebtSignedUsd)));
        setCustomerLedgerChargesUsd(Number(balances.totalOrdersBeforeCommissionUsd) || 0);
        setCustomerLedgerPaymentsUsd(Number(balances.totalPaymentsUsd) || 0);
        setCustomerLedgerWithdrawalsUsd(Number(balances.totalWithdrawalsUsd) || 0);
        setServerCommissionBalanceUsd(Number(balances.commissionBalanceUsd) || 0);
        setServerCreditBalanceUsd(Number(balances.creditBalanceUsd) || 0);
        setCustomer((cur) =>
          cur?.id === cid
            ? { ...cur, customerBalanceUsd: balances.internalSignedUsd || balances.customerBalanceUsd }
            : cur,
        );
      } else {
        void refreshCustomerOpenDebt(cid);
      }
      logPaymentCapturePerf({
        label: "customerWorkspaceAwait",
        totalCustomerLoadMs,
        ordersMs: workspaceRes.ms,
        balancesMs: balancesRes.ms,
        customerPaymentsMs: workspaceRes.ms,
      });
      if (opts?.focusAmount === true) focusFirstAmountInput();
      return true;
    },
    [intakeDocumentWorkCountry, intakeWeekCode, orderSourceDateYmd, focusFirstAmountInput, loadCustomerWorkspaceInBackground, refreshCustomerOpenDebt],
  );

  /** מעבר בין קודי תשלום — רק טופס/שורות; בלי לגעת ב-workspace לקוח */
  const applyPaymentFormOnly = useCallback(
    (snapshot: PaymentEntryResponse) => {
      const pageScrollY = window.scrollY;
      const tableScroll = tableScrollRef.current?.scrollTop ?? 0;
      const snap = clonePaymentEntry(snapshot);

      setLoadedPayment(snap);
      setPreviewPaymentCode(snap.paymentCode?.trim() || null);
      setPaymentCodePreviewPending(false);
      setPaymentDateYmd(snap.paymentDateYmd);
      setPaymentTimeHm(snap.paymentTimeHm);
      if (snap.dollarRate?.trim()) {
        dollarRateTouchedRef.current = true;
        setDollarRate(snap.dollarRate.trim());
      }
      setCommissionPercentStr(
        snap.commissionPercent?.trim() ? snap.commissionPercent.trim() : systemCommissionPercentStr,
      );
      setPayments(
        snap.lines.length > 0
          ? snap.lines.map((l) => ({
              ...l,
              checks: l.checks?.map((ch) => ({ ...ch })),
            }))
          : [createDefaultLine()],
      );
      setActivePaymentLineIndex(0);
      setIncludedIds(null);
      setSavedBaselinePaymentTotalUsd(baselineUsdFromEntry(snap, parseNum(dollarRate)));

      window.setTimeout(() => {
        window.scrollTo({ top: pageScrollY });
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = tableScroll;
        syncBaselineSoon();
      }, 0);
    },
    [systemCommissionPercentStr],
  );

  const applyPaymentShellSync = useCallback(
    (snapshot: PaymentEntryResponse) => {
      const pageScrollY = window.scrollY;
      const tableScroll = tableScrollRef.current?.scrollTop ?? 0;
      const snap = clonePaymentEntry(snapshot);
      const intakeWeek = intakeWeekFromPaymentEntry(snap);
      const targetCustomerId = snap.customer.id?.trim() ?? "";
      const sameCustomer = Boolean(targetCustomerId) && customer?.id === targetCustomerId;

      if (!sameCustomer) {
        custSearchGenRef.current += 1;
        setOrders([]);
        setCustomerPayments([]);
      }

      setPaymentDateYmd(snap.paymentDateYmd);
      setIntakeDateYmd(snap.intakeDateYmd?.trim() || snap.paymentDateYmd);
      setWeekDraft(intakeWeek);
      setOrderSourceDateYmd(defaultOrderSourceDateYmdForIntakeWeek(intakeWeek));
      setLoadedPayment(snap);
      setPreviewPaymentCode(snap.paymentCode?.trim() || null);
      setPaymentCodePreviewPending(false);
      setPaymentTimeHm(snap.paymentTimeHm);
      if (snap.dollarRate?.trim()) {
        dollarRateTouchedRef.current = true;
        setDollarRate(snap.dollarRate.trim());
      }
      setCommissionPercentStr(
        snap.commissionPercent?.trim() ? snap.commissionPercent.trim() : systemCommissionPercentStr,
      );
      setPayments(
        snap.lines.length > 0
          ? snap.lines.map((l) => ({
              ...l,
              checks: l.checks?.map((ch) => ({ ...ch })),
            }))
          : [createDefaultLine()],
      );
      setActivePaymentLineIndex(0);
      setIncludedIds(null);
      setSavedBaselinePaymentTotalUsd(baselineUsdFromEntry(snap, parseNum(dollarRate)));
      setDraftCustomer({
        code: snap.customer.customerCode ?? "",
        displayName: snap.customer.displayName ?? "",
        nameEn: snap.customer.nameEn ?? "",
        nameAr: snap.customer.nameAr ?? "",
        phone: snap.customer.phone ?? "",
        index: snap.customer.customerIndex ?? "",
      });
      setCustomer({
        id: snap.customer.id,
        displayName: snap.customer.displayName,
        nameEn: snap.customer.nameEn || null,
        nameHe: null,
        nameAr: snap.customer.nameAr || null,
        phone: snap.customer.phone || null,
        customerCode: snap.customer.customerCode || null,
        customerIndex: snap.customer.customerIndex || null,
        customerBalanceUsd: sameCustomer && customer ? customer.customerBalanceUsd : "0.00",
      });

      window.setTimeout(() => {
        window.scrollTo({ top: pageScrollY });
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = tableScroll;
        syncBaselineSoon();
      }, 0);
    },
    [customer, systemCommissionPercentStr],
  );

  const hydratePaymentCustomerData = useCallback(
    async (snapshot: PaymentEntryResponse): Promise<boolean> => {
      const customerId = snapshot.customer.id?.trim();
      if (!customerId) return false;
      const intakeWeek = intakeWeekFromPaymentEntry(snapshot);
      const snapshotWeek = orderSourceWeekForIntakeWeek(intakeWeek);
      const wc = paymentIntakeTableWorkCountry(
        countryOverride,
        (snapshot.paymentCode ?? "").trim(),
        globalCountry,
      );
      const key = paymentCustomerHydrateKey(customerId, snapshotWeek, wc);
      const gen = ++paymentHydrateGenRef.current;

      const cached = customerHydrateCacheRef.current.get(key);
      if (cached) {
        if (gen !== paymentHydrateGenRef.current) return true;
        setCustomer(cached.customer);
        setCustomerPayments(cached.customerPayments);
        setOrders(cached.orders);
        setOrdersLoading(false);
        setDraftCustomer({
          code: cached.customer.customerCode ?? "",
          displayName: cached.customer.displayName ?? "",
          nameEn: cached.customer.nameEn ?? cached.customer.nameHe ?? "",
          nameAr: cached.customer.nameAr ?? "",
          phone: cached.customer.phone ?? "",
          index: cached.customer.customerIndex ?? "",
        });
        setCommissionResetIds([]);
        setCustomerBalanceResetPending(false);
        setBalanceResetFromCredit(false);
        setIncludedIds(null);
        return true;
      }

      setOrdersLoading(true);
      const res = await fetchPaymentIntakeCustomerOrdersAction(customerId, snapshotWeek, wc);
      if (gen !== paymentHydrateGenRef.current) return true;
      setOrdersLoading(false);
      if (!res.ok) {
        setLoadErr(res.error);
        return false;
      }
      customerHydrateCacheRef.current.set(key, {
        customer: res.customer,
        orders: res.orders,
        customerPayments: res.customerPayments,
      });
      setCustomer(res.customer);
      setCustomerPayments(res.customerPayments);
      setOrders(res.orders);
      setCommissionResetIds([]);
      setCustomerBalanceResetPending(false);
      setBalanceResetFromCredit(false);
      setDraftCustomer({
        code: res.customer.customerCode ?? "",
        displayName: res.customer.displayName ?? "",
        nameEn: res.customer.nameEn ?? res.customer.nameHe ?? "",
        nameAr: res.customer.nameAr ?? "",
        phone: res.customer.phone ?? "",
        index: res.customer.customerIndex ?? "",
      });
      setIncludedIds(null);
      return true;
    },
    [countryOverride, globalCountry],
  );

  const buildSnapshotFromCurrentState = useCallback((): PaymentCaptureSnapshot | null => {
    const pid = loadedPayment.id?.trim();
    const code = (displayedPaymentCode || loadedPayment.paymentCode || "").trim();
    if (!pid || pid === NEW_CAPTURE_ROW_ID || !code || !customer) return null;

    return {
      paymentId: pid,
      paymentCode: code,
      entry: clonePaymentEntry(loadedPayment) as PaymentCaptureEntryData,
      paymentDateYmd,
      paymentTimeHm,
      weekDraft,
      orderSourceDateYmd,
      dollarRate,
      commissionPercentStr,
      payments: payments.map((l) => ({
        ...l,
        checks: l.checks?.map((ch) => ({ ...ch })),
      })),
      activePaymentLineIndex,
      previewPaymentCode,
      countryOverride,
      customer: { ...customer },
      customerPayments: customerPayments.map((p) => ({ ...p })),
      orders: orders.map((o) => ({ ...o })),
      draftCustomer: { ...draftCustomer },
      includedIds: includedIds ? [...includedIds] : null,
      commissionResetIds: [...commissionResetIds],
      customerBalanceResetPending,
      balanceResetFromCredit,
      customerOpenDebtSignedUsd: customerOpenDebtSignedUsd ?? 0,
    };
  }, [
    loadedPayment,
    displayedPaymentCode,
    customer,
    paymentDateYmd,
    paymentTimeHm,
    weekDraft,
    orderSourceDateYmd,
    dollarRate,
    commissionPercentStr,
    payments,
    activePaymentLineIndex,
    previewPaymentCode,
    countryOverride,
    customerPayments,
    orders,
    draftCustomer,
    includedIds,
    commissionResetIds,
    customerBalanceResetPending,
    balanceResetFromCredit,
    customerOpenDebtSignedUsd,
  ]);
  buildSnapshotRef.current = buildSnapshotFromCurrentState;

  const applyPaymentSnapshot = useCallback(
    (snapshot: PaymentCaptureSnapshot): boolean => {
      const pageScrollY = window.scrollY;
      const tableScroll = tableScrollRef.current?.scrollTop ?? 0;
      const snap = clonePaymentCaptureSnapshot(snapshot);

      logPaymentCapturePerf({
        label: "navigation.applySnapshot",
        paymentId: snap.paymentId,
        paymentCode: snap.paymentCode,
        source: "CACHE",
      });

      custSearchGenRef.current += 1;
      setCommissionResetIds(snap.commissionResetIds);
      setCustomerBalanceResetPending(snap.customerBalanceResetPending);
      setBalanceResetFromCredit(snap.balanceResetFromCredit ?? false);
      setIncludedIds(snap.includedIds);
      setHighlightInvalidCheckFields(false);
      setCountryOverride(snap.countryOverride);
      setCustomer(snap.customer);
      setCustomerPayments(snap.customerPayments);
      setOrders(snap.orders);
      setLoadedPayment(snap.entry as PaymentEntryResponse);
      setPreviewPaymentCode(snap.previewPaymentCode);
      setPaymentCodePreviewPending(false);
      setPaymentDateYmd(snap.paymentDateYmd);
      setPaymentTimeHm(snap.paymentTimeHm);
      setWeekDraft(snap.weekDraft);
      setOrderSourceDateYmd(
        snap.orderSourceDateYmd?.trim() ||
          defaultOrderSourceDateYmdForIntakeWeek(snap.weekDraft),
      );
      if (snap.dollarRate.trim()) {
        dollarRateTouchedRef.current = true;
        setDollarRate(snap.dollarRate);
      }
      setCommissionPercentStr(snap.commissionPercentStr);
      setPayments(
        snap.payments.length > 0
          ? snap.payments.map((l) => ({
              ...l,
              checks: l.checks?.map((ch) => ({ ...ch })),
            }))
          : [createDefaultLine()],
      );
      setActivePaymentLineIndex(snap.activePaymentLineIndex);
      setDraftCustomer({ ...snap.draftCustomer });
      setCustomerOpenDebtSignedUsd(snap.customerOpenDebtSignedUsd);
      baselineSigRef.current = "";

      window.setTimeout(() => {
        window.scrollTo({ top: pageScrollY });
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = tableScroll;
        syncBaselineSoon();
      }, 0);

      return true;
    },
    [],
  );

  const fetchAndCachePaymentSnapshot = useCallback(
    async (paymentId: string): Promise<PaymentCaptureSnapshot | null> => {
      const trimmed = paymentId.trim();
      if (!trimmed) return null;

      const existing = paymentSnapshotCacheRef.current.get(trimmed);
      if (existing) return existing;

      const entry = await fetchPaymentEntryClient(trimmed);
      if (!entry) return null;
      cachePaymentEntry(entry as PaymentEntryResponse);
      return buildSnapshotRef.current?.() ?? null;
    },
    [cachePaymentEntry],
  );

  const resolveCachedSnapshot = useCallback(
    (paymentId: string, paymentCode?: string | null): PaymentCaptureSnapshot | undefined => {
      const id = paymentId.trim();
      const code = paymentCode?.trim().toUpperCase() || null;
      return (
        paymentSnapshotCacheRef.current.get(id) ??
        (code ? paymentSnapshotCacheRef.current.getByCode(code) : undefined)
      );
    },
    [],
  );

  const loadPaymentByCode = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q) return;

      setPaymentCodeSearchBusy(true);
      try {
        const res = await resolveCapturePaymentByCodeQueryAction(q, intakeDocumentWorkCountry);
        if (!res.ok) {
          onToast(res.error);
          return;
        }

        logPaymentCapturePerf({
          label: "navigation.searchByCode",
          paymentCode: res.paymentCode,
          paymentId: res.paymentId,
          source: "NETWORK",
        });

        const ok = await loadPaymentRef.current(res.paymentId, { forceNetwork: true });
        if (!ok) return;

        setPaymentCodeSearch(res.paymentCode);
      } finally {
        setPaymentCodeSearchBusy(false);
      }
    },
    [intakeDocumentWorkCountry, onToast],
  );

  const applyIntakeWeekCode = useCallback(
    (code: string, opts?: { reloadOrders?: boolean }) => {
      const raw = code.trim().toUpperCase();
      const norm = normalizeAhWeekCode(raw);
      if (!norm || !getAhWeekRange(norm)) {
        setWeekDraft(raw);
        return;
      }
      setWeekDraft(norm);
      setWeekInputErr(null);
      const closing = defaultPaymentIntakeDateYmd(norm);
      setIntakeDateYmd(closing);
      setPaymentDateYmd(closing);
      setOrderSourceDateYmd(defaultOrderSourceDateYmdForIntakeWeek(norm));
      if (opts?.reloadOrders && customer?.id) {
        const srcWeek = weekCodeForPaymentIntakeOrders(norm) ?? resolveOrderSourceWeekCode(norm);
        void loadCustomerOrders(customer.id, { silent: true, weekCode: srcWeek ?? undefined });
      }
    },
    [customer?.id, loadCustomerOrders],
  );

  const shiftIntakeWeek = useCallback(
    (delta: -1 | 1) => {
      const cur =
        normalizeAhWeekCode(weekDraft) ?? defaultPaymentIntakeWeekCode(globalWeek);
      const next =
        delta === -1 ? getPrevAhWeek(cur)?.code : getNextAhWeek(cur)?.code;
      if (next) applyIntakeWeekCode(next, { reloadOrders: true });
    },
    [weekDraft, globalWeek, applyIntakeWeekCode],
  );

  const goToCurrentWorkWeek = useCallback(() => {
    applyIntakeWeekCode(defaultPaymentIntakeWeekCode(globalWeek), { reloadOrders: true });
  }, [applyIntakeWeekCode, globalWeek]);

  useEffect(() => {
    const isNewCapture = !loadedPayment.id?.trim();
    if (!isNewCapture) return;
    applyIntakeWeekCode(defaultPaymentIntakeWeekCode(globalWeek), {
      reloadOrders: !!customer?.id?.trim(),
    });
  }, [globalWeek]); // eslint-disable-line react-hooks/exhaustive-deps -- sync new-capture intake week to selected work week

  /** בחירת לקוח מיידית — פוקוס לסכום; הזמנות נטענות ברקע בלי לאפס את הטבלה */
  const selectCustomerQuick = useCallback(
    (row: CustomerSearchRow, opts?: { focusAmount?: boolean; searchStartedAt?: number }) => {
      const renderStart = performance.now();
      if (opts?.searchStartedAt != null) {
        customerSearchPerfRef.current = Math.round(performance.now() - opts.searchStartedAt);
        logPaymentCapturePerf({
          label: "customerFound",
          customerFoundMs: customerSearchPerfRef.current,
        });
      }

      setLoadErr(null);
      setCommissionResetIds([]);
      setCustomerBalanceResetPending(false);
      setBalanceResetFromCredit(false);
      setOrders([]);
      setCustomerPayments([]);
      setCustomerOpenDebtSignedUsd(null);
      setCustomerLedgerChargesUsd(null);
      setCustomerLedgerPaymentsUsd(null);
      setCustomerLedgerWithdrawalsUsd(null);
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
      const weekForLoad =
        weekCodeForPaymentIntakeOrders(intakeWeekCode, orderSourceDateYmd) ?? orderSourceWeekCode;
      logPaymentCapturePerf({
        label: "customerRender",
        renderMs: Math.round(performance.now() - renderStart),
      });
      loadCustomerWorkspaceInBackground(row.id, weekForLoad);
    },
    [focusFirstAmountInput, intakeWeekCode, orderSourceDateYmd, orderSourceWeekCode, loadCustomerWorkspaceInBackground],
  );

  const pickCustHit = useCallback(
    (row: CustomerSearchRow) => {
      custSearchGenRef.current += 1;
      pendingEnterSelectRef.current = false;
      customerCodeEnterBusyRef.current = false;
      setCustomerCodeEnterBusy(false);
      custHitsQueryRef.current = null;
      setCustActiveIndex(-1);
      selectCustomerQuick(row, { focusAmount: true });
    },
    [selectCustomerQuick],
  );

  const showCustomerCodeNotFound = useCallback(() => {
    setCustomerHits([]);
    setCustDdOpen(false);
    setCustActiveIndex(-1);
    setCustSearchNoHits(true);
    onToast("לא נמצא לקוח עם קוד זה");
  }, [onToast]);
  const pickCustHitRef = useRef(pickCustHit);
  pickCustHitRef.current = pickCustHit;
  const showCustomerCodeNotFoundRef = useRef(showCustomerCodeNotFound);
  showCustomerCodeNotFoundRef.current = showCustomerCodeNotFound;

  const clearCustomerSelectionFromDraftEdit = useCallback((field: CustFieldKey, value: string) => {
    setCustomer(null);
    setCustomerPayments([]);
    setOrders([]);
    setIncludedIds(null);
    setCustomerOpenDebtSignedUsd(null);
    setCustomerLedgerChargesUsd(null);
    setCustomerLedgerPaymentsUsd(null);
    setCustomerLedgerWithdrawalsUsd(null);
    setOrderEditId(null);
    setLoadErr(null);
    setCustSearchNoHits(false);
    custHitsQueryRef.current = null;
    setCustomerHits([]);
    setCustActiveIndex(-1);
    setDraftCustomer({
      ...EMPTY_CUSTOMER_DRAFT,
      [field]: value,
    });
  }, []);

  const onDraftCustomerChange = useCallback((field: CustFieldKey, value: string) => {
    lastEditedFieldRef.current = field;
    pendingEnterSelectRef.current = false;
    if (customerCodeEnterBusyRef.current) {
      customerCodeEnterBusyRef.current = false;
      setCustomerCodeEnterBusy(false);
    }
    const prevValue = draftCustomerRef.current[field];
    if (customer && value !== prevValue) {
      clearCustomerSelectionFromDraftEdit(field, value);
    } else {
      setDraftCustomer((prev) => ({ ...prev, [field]: value }));
    }
    setSearchTick((n) => n + 1);
    setCustDdOpen(field !== "phone");
    setCustActiveIndex(-1);
  }, [clearCustomerSelectionFromDraftEdit, customer]);

  const triggerFieldSearch = useCallback((field: CustFieldKey) => {
    lastEditedFieldRef.current = field;
    setSearchTick((n) => n + 1);
    setCustDdOpen(true);
    setCustActiveIndex(-1);
  }, []);

  /** פוקוס לקוד לקוח בפתיחה — פעם אחת; לא חוזר אחרי טעינת קוד תשלום ברקע */
  useLayoutEffect(() => {
    focusCustomerCodeInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only
  }, []);

  const commitCustomerFromEnter = useCallback(
    async (field: CustFieldKey) => {
      const query = draftCustomerRef.current[field].trim();
      const decision = resolveCustomerEnterSelection({
        query,
        hits: customerHitsRef.current,
        activeIndex: custActiveIndexRef.current,
        hitsQuery: lastEditedFieldRef.current === field ? custHitsQueryRef.current : null,
        field: field === "code" ? "code" : "text",
        alreadySelected: selectedCustomerRef.current,
      });

      if (decision.action === "pick") {
        pickCustHit(decision.row);
        return;
      }

      if (decision.action === "none") {
        if (field === "code" && query && !selectedCustomerRef.current) {
          showCustomerCodeNotFound();
        }
        return;
      }

      if (field !== "code") return;

      const pending = custPendingSearchRef.current;
      if (pending && pending.field === field && pending.query === query) {
        pendingEnterSelectRef.current = true;
        customerCodeEnterBusyRef.current = true;
        setCustomerCodeEnterBusy(true);
        return;
      }

      if (customerCodeEnterBusyRef.current) return;
      customerCodeEnterBusyRef.current = true;
      const enterGen = ++customerCodeEnterGenRef.current;
      setCustomerCodeEnterBusy(true);
      const searchGen = ++custSearchGenRef.current;
      try {
        const rows = await searchCustomerSuggestionsClient(query, {
          field: "code",
          workCountry: intakeDocumentWorkCountry,
        });
        if (enterGen !== customerCodeEnterGenRef.current) return;
        if (searchGen !== custSearchGenRef.current) return;
        if (draftCustomerRef.current.code.trim() !== query) return;

        const chosen = pickAutoCustomerHit(rows, query) ?? rows[0] ?? null;
        if (chosen) {
          pickCustHit(chosen);
          return;
        }
        custHitsQueryRef.current = query;
        showCustomerCodeNotFound();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (enterGen === customerCodeEnterGenRef.current) {
          setLoadErr("בעיה בחיבור לשרת");
        }
      } finally {
        if (enterGen === customerCodeEnterGenRef.current) {
          customerCodeEnterBusyRef.current = false;
          setCustomerCodeEnterBusy(false);
        }
      }
    },
    [intakeDocumentWorkCountry, pickCustHit, showCustomerCodeNotFound],
  );

  const handleCustomerFieldKeyDown = useCallback((field: CustFieldKey, e: ReactKeyboardEvent<HTMLInputElement>) => {
    const hitsCount = customerHitsRef.current.length;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      pendingEnterSelectRef.current = false;
      setCustDdOpen(false);
      setCustActiveIndex(-1);
      return;
    }
    if (e.key === "ArrowDown") {
      if (hitsCount === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setCustDdOpen(field !== "phone");
      setCustActiveIndex((prev) => {
        const next = prev < 0 ? 0 : Math.min(prev + 1, hitsCount - 1);
        custActiveIndexRef.current = next;
        return next;
      });
      return;
    }
    if (e.key === "ArrowUp") {
      if (hitsCount === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setCustDdOpen(field !== "phone");
      setCustActiveIndex((prev) => {
        const next = prev <= 0 ? 0 : prev - 1;
        custActiveIndexRef.current = next;
        return next;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void commitCustomerFromEnter(field);
    }
  }, [commitCustomerFromEnter]);

  function syncBaselineSoon() {
    window.setTimeout(() => {
      baselineSigRef.current = currentSigRef.current;
    }, 0);
  }

  const startNewCapturePayment = useCallback(() => {
    custSearchGenRef.current += 1;
    setEditingBadge(null);
    setCountryOverride("AUTO");
    setCustomer(null);
    setCustomerPayments([]);
    setOrders([]);
    setDraftCustomer({ ...EMPTY_CUSTOMER_DRAFT });
    pendingEnterSelectRef.current = false;
    customerCodeEnterBusyRef.current = false;
    setCustomerCodeEnterBusy(false);
    custHitsQueryRef.current = null;
    setCustomerHits([]);
    setCustDdOpen(false);
    setIncludedIds(null);
    setCustSearchNoHits(false);
    setOrderEditId(null);
    setPayments([createDefaultLine()]);
    setActivePaymentLineIndex(0);
    dollarRateTouchedRef.current = false;
    commissionPercentTouchedRef.current = false;
    setDollarRate(parseFinalRate(financial).toFixed(4));
    setCommissionPercentStr(systemCommissionPercentStr);
    const defWeek = defaultPaymentIntakeWeekCode(globalWeek);
    setWeekDraft(defWeek);
    setWeekInputErr(null);
    const closing = defaultPaymentIntakeDateYmd(defWeek);
    setPaymentDateYmd(closing);
    setOrderSourceDateYmd(defaultOrderSourceDateYmdForIntakeWeek(defWeek));
    setIntakeDateYmd(closing);
    setPaymentTimeHm(formatLocalHm(new Date()));
    setPaymentNavLoading(false);
    setLoadErr(null);
    setSaveErr(null);
    setHighlightInvalidCheckFields(false);
    setCommissionResetIds([]);
    setCustomerBalanceResetPending(false);
    setBalanceResetFromCredit(false);
    setCustomerOpenDebtSignedUsd(null);
    setCustomerLedgerChargesUsd(null);
    setCustomerLedgerPaymentsUsd(null);
    setCustomerLedgerWithdrawalsUsd(null);
    setSavedBaselinePaymentTotalUsd(0);
    setOrdersLoading(false);
    setBalancesLoading(false);
    setPaymentsLoading(false);
    customerWorkspaceGenRef.current += 1;
    setPreviewPaymentCode(null);
    setPaymentCodePreviewPending(true);
    setPaymentCodeSearch("");
    setCancelReasonDraft("");
    setCancelNotesDraft("");
    setCancelRequestHint({ status: "none" });
    setLoadedPayment(createNewCaptureLoadedPayment("", globalWeek));
    clearPaymentEntryCaches();
    baselineSigRef.current = "";
    refreshPaymentCodePreview();
    syncBaselineSoon();
    window.setTimeout(() => focusCustomerCodeInput(), 0);
  }, [
    financial,
    systemCommissionPercentStr,
    globalWeek,
    refreshPaymentCodePreview,
    clearPaymentEntryCaches,
    focusCustomerCodeInput,
  ]);

  async function applyPaymentEntry(snapshot: PaymentEntryResponse): Promise<boolean> {
    const snap = clonePaymentEntry(snapshot);
    const targetCustomerId = snap.customer.id?.trim() ?? "";
    if (!targetCustomerId) {
      setSaveErr("חסר לקוח בקליטת תשלום");
      return false;
    }
    const snapshotWeek = orderSourceWeekForIntakeWeek(intakeWeekFromPaymentEntry(snap));
    const currentCustomerId = customer?.id?.trim() ?? "";

    applyPaymentShellSync(snap);
    if (currentCustomerId !== targetCustomerId) {
      custSearchGenRef.current += 1;
      loadCustomerWorkspaceInBackground(targetCustomerId, snapshotWeek, {
        perfLabel: "openPaymentBackground",
        cacheSnapshotPaymentId: snap.id.trim() || undefined,
      });
    }
    return true;
  }

  /**
   * פתיחת תשלום — entry + סיכום לקוח מיידית; הזמנות/יתרות ברקע.
   */
  async function loadPayment(paymentId: string, opts?: { forceNetwork?: boolean }): Promise<boolean> {
    const trimmed = paymentId.trim();
    if (!trimmed) return false;

    const openStart = performance.now();
    setSaveErr(null);
    setLoadErr(null);

    if (!opts?.forceNetwork) {
      const cached = resolveCachedSnapshot(trimmed);
      if (cached) {
        const ok = applyPaymentSnapshot(cached);
        if (ok) void refreshCancelRequestHint(trimmed);
        logPaymentCapturePerf({
          label: "openPayment",
          paymentId: trimmed,
          paymentCode: cached.paymentCode,
          source: "CACHE",
          openPaymentMs: Math.round(performance.now() - openStart),
          loadPaymentMs: 0,
        });
        return ok;
      }
    }

    try {
      const entryStart = performance.now();
      const entry = await fetchPaymentEntryClient(trimmed, { forceNetwork: opts?.forceNetwork });
      const loadPaymentMs = Math.round(performance.now() - entryStart);
      if (!entry) {
        setSaveErr("לא ניתן לטעון קליטת תשלום");
        return false;
      }

      cachePaymentEntry(entry as PaymentEntryResponse);
      const shellStart = performance.now();
      applyPaymentShellSync(entry as PaymentEntryResponse);
      setPaymentCodePreviewPending(false);
      void refreshCancelRequestHint(trimmed);
      const renderMs = Math.round(performance.now() - shellStart);

      const customerId = entry.customer.id?.trim();
      const snapshotWeek = orderSourceWeekForIntakeWeek(intakeWeekFromPaymentEntry(entry));
      if (customerId) {
        loadCustomerWorkspaceInBackground(customerId, snapshotWeek, {
          perfLabel: "openPaymentBackground",
          cacheSnapshotPaymentId: trimmed,
        });
      }

      logPaymentCapturePerf({
        label: "openPayment",
        paymentId: trimmed,
        paymentCode: entry.paymentCode ?? undefined,
        source: "NETWORK",
        openPaymentMs: Math.round(performance.now() - openStart),
        loadPaymentMs,
        renderMs,
      });
      return true;
    } catch {
      setSaveErr("שגיאת רשת בטעינת תשלום");
      return false;
    }
  }

  loadPaymentRef.current = loadPayment;

  useEffect(() => {
    if (savedCapturePaymentId) return;
    refreshPaymentCodePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- רק מדינה / מעבר לקליטה חדשה
  }, [captureWorkCountry, savedCapturePaymentId]);

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
    startNewCapturePayment();
  }, [resetOnKey, startNewCapturePayment]);

  useEffect(() => {
    let cancelled = false;
    const gen = ++custSearchGenRef.current;
    const abort = new AbortController();
    const pendingField = lastEditedFieldRef.current;
    const pendingQuery = draftCustomerRef.current[pendingField].trim();
    custPendingSearchRef.current = { field: pendingField, query: pendingQuery, gen };

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
            custHitsQueryRef.current = null;
            setCustomerHits([]);
            setCustDdOpen(false);
            setCustSearchNoHits(false);
            setCustSearching(false);
            setCustActiveIndex(-1);
            if (pendingEnterSelectRef.current) {
              pendingEnterSelectRef.current = false;
              customerCodeEnterBusyRef.current = false;
              setCustomerCodeEnterBusy(false);
            }
            if (allEmpty) {
              setCustomer(null);
              setCustomerPayments([]);
              setOrders([]);
              setIncludedIds(null);
              setCustomerOpenDebtSignedUsd(null);
              setCustomerLedgerChargesUsd(null);
              setCustomerLedgerPaymentsUsd(null);
              setCustomerLedgerWithdrawalsUsd(null);
              setLoadErr(null);
            }
          }
          return;
        }
        if (!customerSearchMinQueryLength(q, field === "code")) {
          custHitsQueryRef.current = q;
          setCustomerHits([]);
          setCustDdOpen(false);
          setCustSearchNoHits(false);
          setCustSearching(false);
          setCustActiveIndex(-1);
            if (pendingEnterSelectRef.current && field === "code") {
            pendingEnterSelectRef.current = false;
            customerCodeEnterBusyRef.current = false;
            setCustomerCodeEnterBusy(false);
            showCustomerCodeNotFoundRef.current();
          }
          return;
        }

        setCustSearching(true);
        setCustSearchField(field);
        setCustSearchNoHits(false);
        try {
          const searchWc = intakeDocumentWorkCountry;
          const rows = await searchCustomerSuggestionsClient(q, {
            field: field === "code" ? "code" : "text",
            signal: abort.signal,
            workCountry: searchWc,
          });
          if (cancelled || gen !== custSearchGenRef.current) return;

          const still = draftCustomerRef.current[lastEditedFieldRef.current].trim() === q;
          if (!still) return;

          custHitsQueryRef.current = q;
          customerHitsRef.current = rows;

          if (pendingEnterSelectRef.current && field === lastEditedFieldRef.current) {
            pendingEnterSelectRef.current = false;
            customerCodeEnterBusyRef.current = false;
            setCustomerCodeEnterBusy(false);
            const chosen = pickAutoCustomerHit(rows, q) ?? rows[0] ?? null;
            if (chosen) {
              pickCustHitRef.current(chosen);
              return;
            }
            if (field === "code") {
              showCustomerCodeNotFoundRef.current();
              return;
            }
            setCustSearchNoHits(true);
            setCustomerHits([]);
            setCustDdOpen(false);
            setCustActiveIndex(-1);
            return;
          }

          setCustSearchNoHits(rows.length === 0);
          setCustomerHits(rows);
          const nextActive = rows.length > 0 ? 0 : -1;
          custActiveIndexRef.current = nextActive;
          setCustActiveIndex(nextActive);
          setCustDdOpen(rows.length > 0 && field !== "phone");
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          if (!cancelled && gen === custSearchGenRef.current) {
            custHitsQueryRef.current = null;
            setCustomerHits([]);
            setCustSearchNoHits(false);
            setLoadErr("בעיה בחיבור לשרת");
            if (pendingEnterSelectRef.current) {
              pendingEnterSelectRef.current = false;
              customerCodeEnterBusyRef.current = false;
              setCustomerCodeEnterBusy(false);
            }
          }
        } finally {
          if (!cancelled && gen === custSearchGenRef.current) {
            setCustSearching(false);
            setCustSearchField(null);
            if (custPendingSearchRef.current?.gen === gen) {
              custPendingSearchRef.current = null;
            }
          }
        }
      })();
    }, CUSTOMER_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      abort.abort();
      window.clearTimeout(t);
      if (custPendingSearchRef.current?.gen === gen) {
        custPendingSearchRef.current = null;
      }
    };
  }, [searchTick, intakeDocumentWorkCountry]);

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
    surplusDisposition?: SurplusDisposition | null,
    options?: {
      paymentsOverride?: PaymentLine[];
      autoAdjustIntents?: Array<{ method: string; currency: "USD" | "ILS"; amountNative: number }>;
    },
  ): Promise<
    | {
        ok: true;
        primaryPaymentCode: string;
        primaryPaymentId: string;
        paymentNumber: number | null;
        customerBalanceUsd: string;
        summary: PaymentPostSaveSummary;
        postSave: {
          remainingDebtUsd: number;
          surplusUsd: number;
          needsSurplusDisposition: boolean;
          needsShortfallResolution: boolean;
          targetOrderIds: string[];
          deferredSurplusUsd: number;
          paymentTotalUsd: number;
        } | null;
      }
    | { ok: false; needsOverageResolution?: boolean; overpaymentUsd?: number }
  > {
    setSaveErr(null);
    setHighlightInvalidCheckFields(false);
    if (saveBusy) return { ok: false };
    if (!customer) {
      setSaveErr("יש לבחור לקוח מהרשימה");
      return { ok: false };
    }
    const saveLines = options?.paymentsOverride ?? payments;
    const saveTotals = options?.paymentsOverride
      ? calculateTotals(saveLines, rateN, DEFAULT_VAT_RATE)
      : totals;
    if (saveTotals.totalUsd <= 0) {
      setSaveErr("יש להוסיף סכום בדולר ו/או בשקל (נדרש שער דולר להמרת שקל)");
      return { ok: false };
    }
    if (rateN <= 0) {
      setSaveErr("שער דולר חיובי");
      return { ok: false };
    }
    const checkErr = validatePaymentCheckLines(saveLines);
    if (checkErr) {
      setSaveErr(checkErr);
      setHighlightInvalidCheckFields(true);
      return { ok: false };
    }
    // חוק עסקי ראשון — אמצעי התשלום המתוכננים מחייבים.
    // אין העברת חוב בין אמצעים; שינוי אמצעי — רק במסך אמצעי מתוכננים.
    // עודף אמיתי לאחר סגירת כל החוב — חלון ייעודי.
    const autoAdjustIntents =
      options?.autoAdjustIntents ?? pendingAutoAdjustIntents ?? null;
    const freshOrders = await reloadIntakeOrdersPreserveForm();
    if (autoAdjustIntents && autoAdjustIntents.length > 0 && !freshOrders) {
      console.error("[payment-intake] ADJUSTMENT_RELOAD_MISMATCH");
      setSaveErr("ADJUSTMENT FAILED — לא ניתן לרענן את ההזמנות לפני השמירה. שמירה חסומה.");
      return { ok: false };
    }
    let ordersForGate = freshOrders ?? orders;
    if (autoAdjustIntents && autoAdjustIntents.length > 0) {
      const plan = planPaymentIntentAdjustments({
        orders: ordersForGate,
        intents: autoAdjustIntents,
        exchangeRate: rateN,
        customerOpenDebtUsd: totalDebtBeforePaymentUsd,
      });
      if (!plan.ok) {
        console.error("[payment-intake] ADJUSTMENT_WRITE_FAILED", plan.error);
        setSaveErr(plan.error);
        return { ok: false };
      }
      if (plan.orderChanges.length > 0) {
        ordersForGate = applyIntentOrderChangesToIntakeOrders(ordersForGate, plan.orderChanges);
      }
    }
    const enteredForGate = buildEnteredByBucket(
      options?.paymentsOverride
        ? aggregateLivePaymentFormKpis(saveLines, rateN)
        : liveFormKpis,
    );
    const applyUsdForGate = options?.paymentsOverride
      ? computePaymentIntakeApplyUsd({
          isExistingPayment,
          formTotalUsd: saveTotals.totalUsd,
          savedBaselineTotalUsd: savedBaselinePaymentTotalUsd,
        })
      : paymentApplyUsd;
    const freshDevRows = computeIntakeSaveDeviations({
      orders: ordersForGate,
      includedOrderIds: includedIds,
      enteredByBucket: enteredForGate,
      formRateN: rateN,
      totalPaymentUsd: applyUsdForGate,
    });
    const saveGates = evaluatePaymentIntakeSaveGates({
      orders: ordersForGate,
      includedOrderIds: includedIds,
      enteredByBucket: enteredForGate,
      totalPaymentUsd: applyUsdForGate,
      openDebtUsd: totalDebtBeforePaymentUsd,
      surplusDisposition: surplusDisposition ?? null,
    });
    if (!saveGates.methodCheck.ok) {
      console.error("[payment-intake]", saveGates.reason ?? "METHOD_RECONCILIATION_FAILED", {
        ...describePostAdjustmentValidation({
          orders: ordersForGate,
          includedOrderIds: includedIds,
          enteredByBucket: enteredForGate,
          totalPaymentUsd: applyUsdForGate,
          openDebtUsd: totalDebtBeforePaymentUsd,
        }),
        week: orderSourceWeekCode,
      });
      setIntakeDevRows(freshDevRows);
      setSaveErr("אמצעי התשלום בפועל שונים מהחלוקה שהוגדרה. יש לעדכן את ההזמנה לפני הקליטה.");
      return { ok: false };
    }
    if (!saveGates.overpaymentCheck.ok) {
      console.error("[payment-intake] OVERPAYMENT_DESTINATION_MISSING", {
        overpaymentUsd: saveGates.overpaymentCheck.overpaymentUsd,
      });
      setSaveErr(
        `יש תשלום יתר של $${saveGates.overpaymentCheck.overpaymentUsd.toFixed(2)}. יש לבחור יתרת זכות או הוספה לעמלות.`,
      );
      return {
        ok: false,
        needsOverageResolution: true,
        overpaymentUsd: saveGates.overpaymentCheck.overpaymentUsd,
      };
    }

    if (intakeHasRateMismatch(freshDevRows)) {
      setIntakeDevRows(freshDevRows);
      setSaveErr("שער הדולר שנקלט שונה מהשער של ההזמנה. יש לבדוק את הנתונים לפני שמירה.");
      return { ok: false };
    }
    setIntakeDevRows([]);
    const basesForSave = toPaymentIntakeBases(ordersForGate);
    // חשוב: קרדיט קיים ללקוח לא אומר שצריך "לכפות" תשלום כיתרת זכות.
    // תמיד מנסים Allocation (FIFO) קודם; רק עודף מטופל כקרדיט/עמלה לפי בחירת משתמש.
    const forceCustomerCreditPayment = false;
    const allocDiag = logPaymentAllocationPreSave({
      source: "payment-modal",
      customerId: customer?.id ?? null,
      customerLoaded: Boolean(customer),
      ordersLoading,
      ordersCount: ordersForGate.length,
      paymentAmountUsd: saveTotals.totalUsd,
      selectedOrderIds: includedIds,
      weekCode: intakeWeekCode,
      bases: basesForSave,
      prioritizedOrderIds: prioritizedSet,
      forceCustomerCreditPayment,
      lastCustomerSearchExactOnly: lastEditedFieldRef.current === "code",
      custSearchNoHits,
    });
    const { byOrderId, unallocatedUsd } = {
      byOrderId: new Map(allocDiag.allocationTargets.map((t) => [t.orderId, t.amountUsd])),
      unallocatedUsd: allocDiag.unallocatedUsd,
    };
    const hasAlloc = allocDiag.allocationTargets.length > 0;
    // Block only when we KNOW there are no open orders at all.
    // If bases has orders with open debt but client-FIFO returned empty (edge case),
    // let the server attempt allocation rather than blocking here with a misleading error.
    // מסלול יתרת זכות / עמלות לעודף — לא חוסמים כאן: השרת מקצה לחוב ושומר עודף בנפרד.
    const hasOpenOrders = basesForSave.some((b) => orderLedgerBalanceUsd(b) > 0.02);
    const surplusPath =
      surplusDisposition === "credit" || surplusDisposition === "commission";
    if (!hasAlloc && !hasOpenOrders && !surplusPath) {
      setSaveErr("לא נמצאו הזמנות עם יתרת חוב פתוחה — ייתכן שהמסמך כבר שולם במלואו");
      return { ok: false };
    }
    setSaveBusy(true);
    const hm = (paymentTimeHm || "").trim() || formatLocalHm(new Date());
    const weekForSave = intakeWeekCode;
    const saveStart = performance.now();
    const res = await savePaymentUpdatedAction({
      customerId: customer.id,
      receivedToday: false,
      paymentDateYmd,
      paymentTimeHm: hm,
      intakeDateYmd,
      weekCode: weekForSave,
      workCountry: captureWorkCountry,
      dollarRate,
      commissionPercent: commissionPercentStr,
      payments: saveLines,
      includedOrderIds: includedIds,
      // פעולות סגירת חוסר אינן חלק מהשמירה הראשונית — חוב חלקי נשאר פתוח.
      commissionResetOrderIds: null,
      applyCustomerBalanceReset: false,
      applyCustomerBalanceResetFromCredit: false,
      draftNameAr: draftCustomer.nameAr.trim() || null,
      draftNameEn: draftCustomer.nameEn.trim() || null,
      draftPhone: draftCustomer.phone.trim() || null,
      deferSurplusDisposition: !surplusDisposition,
      saveSurplusAsCredit: surplusDisposition === "credit",
      surplusDisposition: surplusDisposition ?? null,
      autoAdjustIntents: autoAdjustIntents,
    });
    const savePaymentMs = Math.round(performance.now() - saveStart);
    if (!res.ok) {
      setSaveBusy(false);
      setSaveErr(res.error);
      return { ok: false };
    }
    const primaryPaymentCode = res.saved.primaryPaymentCode?.trim() ?? "";
    if (!primaryPaymentCode) {
      setSaveBusy(false);
      setSaveErr("שמירה הצליחה אך חסר קוד תשלום");
      return { ok: false };
    }

    setSaveBusy(false);
    setPendingAutoAdjustIntents(null);
    if (saveJustSavedTimerRef.current != null) {
      window.clearTimeout(saveJustSavedTimerRef.current);
    }
    setSaveJustSaved(true);
    saveJustSavedTimerRef.current = window.setTimeout(() => {
      setSaveJustSaved(false);
      saveJustSavedTimerRef.current = null;
    }, 2000);

    const creditApplyUsd = pendingCreditApplyUsd;
    if (creditApplyUsd > 0.01) {
      const creditRes = await applyCustomerCreditToOpenOrdersAction({
        customerId: customer.id,
        maxUsd: creditApplyUsd.toFixed(2),
        orderIds: includedIds ?? undefined,
      });
      if (!creditRes.ok) {
        setSaveErr(creditRes.error);
        return { ok: false };
      }
      onToast(`נוצלה יתרת זכות: $${creditApplyUsd.toFixed(2)}`);
      setBalanceResetFromCredit(false);
    }

    dispatchCashControlRefresh(
      resolvePaymentIntakeAccountingPeriod(weekForSave)?.financialWeek ?? weekForSave,
    );
    window.dispatchEvent(new CustomEvent("wego:balances-refresh"));

    const refreshStart = performance.now();
    const savedDateYmd = paymentDateYmd;
    const savedPaymentId = res.saved.primaryPaymentId?.trim() ?? savedCapturePaymentId ?? "";
    const resetIds = [...commissionResetIds];
    const updatedOrdersForSummary = orders.map((o) => {
      let row = { ...o };
      if (resetIds.includes(o.id)) {
        const plan = planCommissionDebtClosureFromNumbers({
          commissionUsd: Number(o.commissionUsd) || 0,
          totalUsd: Number(o.totalAmountUsd) || 0,
          paidUsd: Number(o.dbPaidUsd) || 0,
        });
        row = {
          ...row,
          commissionUsd: plan.afterCommissionUsd.toFixed(2),
          totalAmountUsd: plan.afterTotalUsd.toFixed(2),
        };
      }
      const alloc = byOrderId.get(o.id) ?? 0;
      if (alloc > 0.001) {
        const newPaid = roundMoney2(parseMoneyStringOrZero(o.dbPaidUsd) + alloc);
        const total = parseMoneyStringOrZero(o.totalAmountUsd);
        const prevRem = parseMoneyStringOrZero(o.dbRemainingUsd);
        const newRem = roundMoney2(Math.max(0, prevRem - alloc));
        row = {
          ...row,
          dbPaidUsd: newPaid.toFixed(2),
          dbRemainingUsd: newRem.toFixed(2),
          lastPaymentDateYmd: savedDateYmd,
          status: debtStatus(newPaid, total, newRem),
        };
      }
      return row;
    });
    const summaryRows =
      includedIds == null
        ? updatedOrdersForSummary
        : updatedOrdersForSummary.filter((order) => includedIds.includes(order.id));
    const documentAmountUsd = roundMoney2(
      summaryRows.reduce((sum, order) => sum + (Number(order.totalAmountUsd) || 0), 0),
    );
    const paidUsd = roundMoney2(
      summaryRows.reduce(
        (sum, order) =>
          sum +
          Math.min(
            Number(order.totalAmountUsd) || 0,
            Math.max(0, Number(order.dbPaidUsd) || 0),
          ),
        0,
      ),
    );
    const remainingUsd = roundMoney2(Math.max(0, documentAmountUsd - paidUsd));
    const postSavePaymentSummary: PaymentPostSaveSummary = {
      targetOrderIds: summaryRows.map((order) => order.id),
      documentAmountUsd,
      paidUsd,
      remainingUsd,
      statusLabel:
        remainingUsd <= 0.01 ? "שולם" : paidUsd > 0.01 ? "שולם חלקית — חוב פתוח" : "לא שולם",
      creditAvailableUsd: creditAvailableForResetUsd,
      commissionAvailableUsd: roundMoney2(
        summaryRows.reduce(
          (sum, order) => sum + Math.max(0, Number(order.commissionUsd) || 0),
          0,
        ),
      ),
    };
    setOrders(updatedOrdersForSummary);
    onToast(buildPostSaveRemainingSummary(updatedOrdersForSummary, null));
    setMethodControlOpen(false);
    // Silent refresh (authoritative rebuild): orders + balances + payments.
    await loadCustomerWorkspaceInBackground(
      customer.id,
      orderSourceWeekForIntakeWeek(weekForSave, orderSourceDateYmd),
      {
        perfLabel: "postSaveSilentRefresh",
        cacheSnapshotPaymentId: savedPaymentId || undefined,
      },
    );
    setCommissionResetIds([]);
    setCustomerBalanceResetPending(false);
    setBalanceResetFromCredit(false);
    setIncludedIds(null);
    setCustomer((cur) => (cur ? { ...cur, customerBalanceUsd: res.saved.customerBalanceUsd } : cur));
    if (customer.id) void refreshCustomerOpenDebt(customer.id);

    if (savedPaymentId) {
      // קישור מסמכים שהועלו תחת מפתח טיוטה ל-paymentId האמיתי (לפני remount של הפאנל).
      const draftKey = docDraftKeyRef.current;
      if (draftKey && draftKey !== savedPaymentId) {
        await attachDraftDocumentsAction(draftKey, savedPaymentId).catch(() => {});
      }
      setLoadedPayment((cur) => ({
        ...cur,
        id: savedPaymentId,
        paymentCode: primaryPaymentCode,
      }));
      setPreviewPaymentCode(primaryPaymentCode);
    }
    syncBaselineSoon();

    const refreshAfterSaveMs = Math.round(performance.now() - refreshStart);
    logPaymentCapturePerf({
      label: "savePayment",
      savePaymentMs,
      refreshAfterSaveMs,
      totalUiUpdateMs: savePaymentMs + refreshAfterSaveMs,
      paymentCode: primaryPaymentCode,
    });

    return {
      ok: true,
      primaryPaymentCode,
      primaryPaymentId: savedPaymentId,
      paymentNumber: res.saved.paymentNumber ?? null,
      customerBalanceUsd: res.saved.customerBalanceUsd,
      summary: postSavePaymentSummary,
      postSave: res.saved.postSave ?? null,
    };
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
    setLoadedPayment(createNewCaptureLoadedPayment(savedCode, intakeWeekCode));
    setDocDraftKey(makeDocDraftKey());
    syncBaselineSoon();
    focusFirstAmountInput();
    refreshPaymentCodePreview();
  }

  async function finishSaveAndNew(savedCode: string) {
    finishSaveAndNewOptimistic(savedCode);
  }

  async function finishAfterSuccessfulSave(
    mode: "new" | "close",
    result: Extract<Awaited<ReturnType<typeof performSave>>, { ok: true }>,
  ) {
    dispatchOrdersListRefresh();
    setPostSaveMode(mode);
    setPostSavePaymentCode(result.primaryPaymentCode);
    setPostSavePaymentNumber(result.paymentNumber);
    setPostSavePrimaryPaymentId(result.primaryPaymentId);

    const postSave = result.postSave;
    if (postSave?.needsSurplusDisposition && postSave.surplusUsd > 0.02) {
      const over = computePaymentOverpayment(
        roundMoney2(postSave.paymentTotalUsd - postSave.surplusUsd),
        postSave.paymentTotalUsd,
      );
      setOveragePreview({
        openDebtIls: roundMoney2(over.openDebtUsd * rateN),
        openDebtUsd: over.openDebtUsd,
        paymentIls: roundMoney2(postSave.paymentTotalUsd * rateN),
        paymentUsd: postSave.paymentTotalUsd,
        closesDebtUsd: over.closesDebtUsd,
        closesDebtIls: roundMoney2(Math.min(postSave.paymentTotalUsd * rateN, over.openDebtUsd * rateN)),
        surplusIls: roundMoney2(postSave.surplusUsd * rateN),
        surplusUsd: postSave.surplusUsd,
        hasOverage: true,
      });
      setPostSaveOverageMode(true);
      setOverageModalOpen(true);
      return;
    }

    if (postSave?.needsShortfallResolution && postSave.remainingDebtUsd > 0.02) {
      setPostSaveRemainingUsd(postSave.remainingDebtUsd);
      setPostSaveTargetOrderIds(postSave.targetOrderIds);
      let commissionBal = serverCommissionBalanceUsd;
      if (customer?.id?.trim()) {
        const balRes = await fetchPaymentIntakeBalancesClient(
          customer.id,
          intakeDocumentWorkCountry,
        );
        if (balRes.ok) {
          commissionBal = Number(balRes.commissionBalanceUsd) || 0;
          setServerCommissionBalanceUsd(commissionBal);
        }
      }
      setPostSaveCommissionBalanceUsd(commissionBal);
      setPostSaveError(null);
      setShortfallModalOpen(true);
      return;
    }

    if (mode === "new") await finishSaveAndNew(result.primaryPaymentCode);
    else closeTop();
  }

  performSaveRef.current = performSave;
  finishAfterSuccessfulSaveRef.current = finishAfterSuccessfulSave;

  async function onPostSaveSurplusConfirm(disposition: SurplusDisposition) {
    if (!customer || !postSavePrimaryPaymentId) return;
    setSaveBusy(true);
    setOverageModalOpen(false);
    try {
      const res = await applyPaymentSurplusDispositionAction({
        customerId: customer.id,
        primaryPaymentId: postSavePrimaryPaymentId,
        disposition,
      });
      if (!res.ok) {
        setSaveErr(res.error);
        setOverageModalOpen(true);
        return;
      }
      setCustomer((cur) =>
        cur ? { ...cur, customerBalanceUsd: res.customerBalanceUsd } : cur,
      );
      window.dispatchEvent(new CustomEvent("wego:balances-refresh"));
      dispatchOrdersListRefresh();
      await loadCustomerWorkspaceInBackground(customer.id, undefined, {
        perfLabel: "postSaveSurplusRefresh",
      });
      setPostSaveOverageMode(false);
      setOveragePreview(null);
      const mode = postSaveMode;
      setPostSaveMode(null);
      setPostSavePrimaryPaymentId("");
      if (mode === "new") await finishSaveAndNew(postSavePaymentCode);
      else if (mode === "close") closeTop();
    } finally {
      setSaveBusy(false);
    }
  }

  function mapShortfallResetError(raw: string): string {
    const msg = raw.trim();
    if (!msg) return "האיפוס נכשל — נסה שוב";
    if (msg.includes("אין הרשאת מנהל")) return "נדרשת הרשאת מנהל לאיפוס דרך עמלות";
    if (msg.includes("לא נמצאו הזמנות") || msg.includes("אין יתרה פתוחה")) {
      return "לא ניתן לאפס כרגע — רענן את המסך ונסה שוב";
    }
    if (msg.includes("נתוני ההזמנה השתנו")) return "נתוני ההזמנה השתנו — רענן ונסה שוב";
    return "האיפוס נכשל — נסה שוב";
  }

  function clearShortfallFlowState() {
    setShortfallModalOpen(false);
    setShortfallModalMode("post_save");
    setShortfallModalSaveMode(null);
    setPostSaveError(null);
    setPostSaveMode(null);
    setPostSavePaymentCode("");
    setPostSavePaymentNumber(null);
    setPostSavePrimaryPaymentId("");
    setPostSaveRemainingUsd(0);
    setPostSaveCommissionBalanceUsd(0);
    setPostSaveTargetOrderIds([]);
  }

  function openInlineShortfallResetModal(saveMode: "new" | "close" | null = null) {
    if (!customer || orderRemainderAfterPaymentUsd <= 0.01) return;
    const targetOrderIds = orderBalanceResetSummary.rows
      .filter((row) => row.calc.adjustmentType === "SHORTFALL")
      .map((row) => row.orderId);
    if (targetOrderIds.length === 0) {
      onToast("לא נמצאה יתרה פתוחה לאיפוס");
      return;
    }
    setShortfallModalMode("preview");
    setShortfallModalSaveMode(saveMode);
    setPostSaveMode(null);
    setPostSavePaymentCode("");
    setPostSavePaymentNumber(null);
    setPostSavePrimaryPaymentId("");
    setPostSaveRemainingUsd(orderRemainderAfterPaymentUsd);
    setPostSaveCommissionBalanceUsd(displayCommissionBalanceUsd);
    setPostSaveTargetOrderIds(targetOrderIds);
    setPostSaveError(null);
    setShortfallModalOpen(true);
  }

  /**
   * Preview תשלום יתר — לפי חוב לקוח SSOT מול התשלום הנוכחי בטופס בלבד.
   * לא לפי סיכום איפוס יתרה להזמנות (שעלול להיות 0 כשיש משיכה מחוב / פער Ledger).
   */
  function buildInlineOveragePreview(): PaymentOveragePreview | null {
    if (paymentPreview.projectedOverpayment <= 0.01) return null;
    const openDebtUsd = paymentPreview.debtBefore;
    const paymentUsd = paymentPreview.draftPaymentTotal;
    const openDebtIls = rateN > 0 ? roundMoney2(openDebtUsd * rateN) : 0;
    const paymentIls = rateN > 0 ? roundMoney2(paymentUsd * rateN) : 0;
    const preview = computePaymentOveragePreview({
      openDebtUsd,
      openDebtIls,
      paymentUsd,
      paymentIls,
    });
    return preview.hasOverage ? preview : null;
  }

  function openInlineOverageModal(mode: "new" | "close" | null = null): boolean {
    const preview = buildInlineOveragePreview();
    if (!preview) return false;
    saveAfterOverageRef.current = mode;
    setPostSaveOverageMode(false);
    setPostSaveMode(null);
    setPostSavePrimaryPaymentId("");
    setOveragePreview(preview);
    setOverageModalOpen(true);
    return true;
  }

  function onShortfallDismiss() {
    if (postSaveBusyAction) return;
    clearShortfallFlowState();
  }

  async function onShortfallAfterSaveResolve(resolution: PaymentShortfallResolution) {
    if (!customer || postSaveBusyAction) return;
    if (shortfallModalMode === "preview") {
      if (resolution === "leave_open") {
        const saveMode = shortfallModalSaveMode;
        if (saveMode) {
          setPostSaveBusyAction("leave_open");
          setPostSaveError(null);
          const saveResult = await performSave(null);
          if (!saveResult.ok) {
            setPostSaveBusyAction(null);
            return;
          }
          clearShortfallFlowState();
          setPostSaveBusyAction(null);
          if (saveMode === "new") await finishSaveAndNew(saveResult.primaryPaymentCode);
          else closeTop();
          return;
        }
        clearShortfallFlowState();
        return;
      }
      setPostSaveBusyAction("reset_commission");
      setPostSaveError(null);
      const saveResult = await performSave(null);
      if (!saveResult.ok) {
        setPostSaveBusyAction(null);
        return;
      }
      const targetOrderIds = saveResult.postSave?.targetOrderIds ?? postSaveTargetOrderIds;
      setPostSavePaymentCode(saveResult.primaryPaymentCode);
      setPostSavePaymentNumber(saveResult.paymentNumber);
      setPostSavePrimaryPaymentId(saveResult.primaryPaymentId);
      setPostSaveRemainingUsd(saveResult.postSave?.remainingDebtUsd ?? postSaveRemainingUsd);
      setPostSaveTargetOrderIds(targetOrderIds);
      setPostSaveCommissionBalanceUsd(displayCommissionBalanceUsd);
      const result = await resetCustomerOutstandingBalancesAction({
        customerId: customer.id,
        weekCode: intakeWeekCode,
        commissionPercent: commissionPercentStr,
        orderIds: targetOrderIds,
        allowNegativeCommission: true,
        paymentCaptureContext:
          saveResult.primaryPaymentCode && saveResult.paymentNumber
            ? { primaryPaymentCode: saveResult.primaryPaymentCode, paymentNumber: saveResult.paymentNumber }
            : null,
      });
      if (!result.ok) {
        setPostSaveBusyAction(null);
        setPostSaveError(mapShortfallResetError(result.error));
        return;
      }
      onToast("התשלום נשמר והיתרה אופסה בהצלחה דרך העמלות");
      window.dispatchEvent(new CustomEvent("wego:balances-refresh"));
      const saveMode = shortfallModalSaveMode;
      await loadPayment(saveResult.primaryPaymentId, { forceNetwork: true });
      await loadCustomerWorkspaceInBackground(customer.id, undefined, {
        perfLabel: "inlineShortfallResetRefresh",
      });
      setPostSaveBusyAction(null);
      clearShortfallFlowState();
      if (saveMode === "new") {
        await finishSaveAndNew(saveResult.primaryPaymentCode);
        return;
      }
      if (saveMode === "close") {
        closeTop();
        return;
      }
      return;
    }

    if (resolution === "leave_open") {
      setPostSaveBusyAction("leave_open");
      setShortfallModalOpen(false);
      setPostSaveError(null);
      const mode = postSaveMode;
      const code = postSavePaymentCode;
      clearShortfallFlowState();
      if (mode === "new" && code) await finishSaveAndNew(code);
      else if (mode === "close") closeTop();
      setPostSaveBusyAction(null);
      return;
    }

    setPostSaveBusyAction("reset_commission");
    setPostSaveError(null);
    const result = await resetCustomerOutstandingBalancesAction({
      customerId: customer.id,
      weekCode: intakeWeekCode,
      commissionPercent: commissionPercentStr,
      orderIds: postSaveTargetOrderIds,
      allowNegativeCommission: true,
      paymentCaptureContext:
        postSavePaymentCode && postSavePaymentNumber
          ? { primaryPaymentCode: postSavePaymentCode, paymentNumber: postSavePaymentNumber }
          : null,
    });
    if (!result.ok) {
      setPostSaveBusyAction(null);
      setPostSaveError(mapShortfallResetError(result.error));
      return;
    }
    onToast("היתרה אופסה בהצלחה דרך העמלות");
    window.dispatchEvent(new CustomEvent("wego:balances-refresh"));
    await loadCustomerWorkspaceInBackground(customer.id, undefined, {
      perfLabel: "postSaveShortfallRefresh",
    });
    const mode = postSaveMode;
    const code = postSavePaymentCode;
    clearShortfallFlowState();
    setPostSaveBusyAction(null);
    if (mode === "new" && code) await finishSaveAndNew(code);
    else if (mode === "close") closeTop();
  }

  async function onSaveAndNew() {
    const saveGates = evaluatePaymentIntakeSaveGates({
      orders,
      includedOrderIds: includedIds,
      enteredByBucket: buildEnteredByBucket(liveFormKpis),
      totalPaymentUsd: paymentApplyUsd,
      openDebtUsd: totalDebtBeforePaymentUsd,
    });
    if (!saveGates.methodCheck.ok) {
      setIntakeDevRows(liveIntakeDevRows);
      setSaveErr("אמצעי התשלום בפועל שונים מהחלוקה שהוגדרה. יש לעדכן את ההזמנה לפני הקליטה.");
      return;
    }
    const overagePreview = buildInlineOveragePreview();
    if (overagePreview) {
      if (!openInlineOverageModal("new")) {
        setSaveErr("קיים תשלום יתר — לא ניתן לפתוח את חלון הטיפול. רעננו את המסך ונסו שוב.");
      }
      return;
    }
    if (orderRemainderAfterPaymentUsd > 0.01 && intakeCorrectionRows.length === 0) {
      openInlineShortfallResetModal("new");
      return;
    }
    saveAfterOverageRef.current = "new";
    const res = await performSave(null);
    if (!res.ok) {
      if (res.needsOverageResolution) openInlineOverageModal("new");
      return;
    }
    saveAfterOverageRef.current = null;
    await finishAfterSuccessfulSave("new", res);
  }

  /**
   * "שמור תשלום" — שומר את התשלום וסוגר את המודאל.
   * זהו ה־flow הסופי / רגיל.
   */
  async function onSaveAndClose() {
    const saveGates = evaluatePaymentIntakeSaveGates({
      orders,
      includedOrderIds: includedIds,
      enteredByBucket: buildEnteredByBucket(liveFormKpis),
      totalPaymentUsd: paymentApplyUsd,
      openDebtUsd: totalDebtBeforePaymentUsd,
    });
    if (!saveGates.methodCheck.ok) {
      setIntakeDevRows(liveIntakeDevRows);
      setSaveErr("אמצעי התשלום בפועל שונים מהחלוקה שהוגדרה. יש לעדכן את ההזמנה לפני הקליטה.");
      return;
    }
    const overagePreview = buildInlineOveragePreview();
    if (overagePreview) {
      if (!openInlineOverageModal("close")) {
        setSaveErr("קיים תשלום יתר — לא ניתן לפתוח את חלון הטיפול. רעננו את המסך ונסו שוב.");
      }
      return;
    }
    if (orderRemainderAfterPaymentUsd > 0.01 && intakeCorrectionRows.length === 0) {
      openInlineShortfallResetModal("close");
      return;
    }
    saveAfterOverageRef.current = "close";
    const res = await performSave(null);
    if (!res.ok) {
      if (res.needsOverageResolution) openInlineOverageModal("close");
      return;
    }
    saveAfterOverageRef.current = null;
    await finishAfterSuccessfulSave("close", res);
  }

  async function onOverageConfirm(disposition: SurplusDisposition) {
    if (postSaveOverageMode) {
      await onPostSaveSurplusConfirm(disposition);
      return;
    }
    if (!customer || saveBusy || overageConfirmInFlightRef.current) return;
    overageConfirmInFlightRef.current = true;
    try {
      const mode = saveAfterOverageRef.current;
      const res = await performSave(disposition);
      if (!res.ok) {
        if (!res.needsOverageResolution) {
          setOverageModalOpen(false);
          setOveragePreview(null);
        }
        return;
      }
      setOverageModalOpen(false);
      setOveragePreview(null);
      saveAfterOverageRef.current = null;
      if (mode === "new" || mode === "close") {
        await finishAfterSuccessfulSave(mode, res);
        return;
      }
      onToast(
        disposition === "credit"
          ? `${formatOverpaymentUsdSigned(overagePreview?.surplusUsd ?? 0)} נשמרו כיתרת זכות`
          : `${formatPaymentBalanceUsdLine(openDebtAfterPaymentPreview.paymentBalanceDisplay)} נוספו לעמלות`,
      );
      await loadPayment(res.primaryPaymentId, { forceNetwork: true });
      await loadCustomerWorkspaceInBackground(customer.id, undefined, {
        perfLabel: "inlineOverpaymentRefresh",
      });
    } finally {
      overageConfirmInFlightRef.current = false;
    }
  }

  function onOverageEditOrder() {
    setOverageModalOpen(false);
    setPostSaveOverageMode(false);
    saveAfterOverageRef.current = null;
    setOveragePreview(null);
    const idSet = includedIds ? new Set(includedIds) : null;
    const target =
      matched.find((row) => (!idSet || idSet.has(row.id)) && row.allocationUsd > 0.01)
      ?? orders.find((o) => (!idSet || idSet.has(o.id)) && Number(o.dbRemainingUsd) > 0.01)
      ?? orders[0];
    if (target?.id) {
      openOrderForEdit(target.id);
      return;
    }
    onToast("לא נמצאה הזמנה לעריכה");
  }

  function onIntakeDevEditOrder() {
    setIntakeDevModalOpen(false);
    intakeDevPendingSaveRef.current = false;
    saveAfterOverageRef.current = null;
    saveSurplusPendingRef.current = false;
    const idSet = includedIds ? new Set(includedIds) : null;
    const target =
      orders.find((o) => (!idSet || idSet.has(o.id)) && o.breakdown.length > 0 && Number(o.dbRemainingUsd) > 0.02)
        ?? orders.find((o) => o.breakdown.length > 0)
        ?? orders[0];
    if (target?.id) setOrderEditId(target.id);
    else onToast("לא נמצאה הזמנה לעריכה");
  }

  function onIntakeDevCancel() {
    setIntakeDevModalOpen(false);
    intakeDevPendingSaveRef.current = false;
    saveAfterOverageRef.current = null;
    saveSurplusPendingRef.current = false;
  }

  async function onIntakeDevAutoFix() {
    const fix = intakeDeviationViewLive?.autoFix;
    if (!fix) return;
    setIntakeDevAutoFixBusy(true);
    try {
      const res = await applyIntakePaymentMethodSwapAction({
        orderId: fix.orderId,
        fromMethod: bucketKeyToDbMethod(fix.fromBucket),
        toMethod: bucketKeyToDbMethod(fix.toBucket),
      });
      if (!res.ok) {
        onToast(res.error);
        return;
      }
      onToast("אמצעי התשלום עודכן — ניתן לשמור את התשלום");
      setIntakeDevModalOpen(false);
      intakeDevPendingSaveRef.current = false;
      dispatchOrdersListRefresh();
      await refreshSharedPaymentIntakeOrders();
    } finally {
      setIntakeDevAutoFixBusy(false);
    }
  }

  function onOverageCancel() {
    setOverageModalOpen(false);
    setPostSaveOverageMode(false);
    saveAfterOverageRef.current = null;
    setOveragePreview(null);
    setPostSaveMode(null);
    setPostSavePrimaryPaymentId("");
  }

  function openCustomerLedger() {
    if (!customer || !canViewCustomerCard) return;
    openWindow({
      type: "customerCard",
      props: { customerId: customer.id, customerName: customer.displayName, initialTab: "ledger" },
    });
  }

  function openOrderForEdit(orderId: string, opts?: { fromMethodControl?: boolean }) {
    if (!canEditOrders) {
      onToast("אין הרשאת עריכת הזמנה");
      return;
    }
    const fromMethodControl = opts?.fromMethodControl === true;
    reopenMethodControlAfterOrderEditRef.current = fromMethodControl;
    if (fromMethodControl) setMethodControlOpen(false);
    setOrderEditId(orderId);
  }

  /**
   * רענון אחד למקור ההזמנות המשותף — מעדכן את טבלת הקליטה ואת חלון האמצעים יחד.
   * לא מאפס בחירת הזמנות / טופס תשלום / טיוטת לקוח.
   */
  async function refreshSharedPaymentIntakeOrders(): Promise<PaymentIntakeOrderRow[] | null> {
    const cid = customer?.id?.trim();
    if (!cid) return null;
    setSharedOrdersRefreshing(true);
    try {
      // ביטול cache ישן — KPI והטבלה חייבים להיגזר מנתונים טריים בלבד.
      customerHydrateCacheRef.current.clear();
      const res = await softRefreshPaymentIntakeOrders({
        customerId: cid,
        weekCode: orderSourceWeekCode,
        workCountry: intakeDocumentWorkCountry,
      });
      if (!res.ok) return null;
      setOrders(res.orders);
      setIntakeDevRows([]);
      setCustomerOpenDebtSignedUsd(parseMoneyStringOrZero(String(res.openDebtSignedUsd)));
      setCustomerLedgerChargesUsd(Number(res.totalOrdersBeforeCommissionUsd) || 0);
      setCustomerLedgerPaymentsUsd(Number(res.totalPaymentsUsd) || 0);
      setCustomerLedgerWithdrawalsUsd(Number(res.totalWithdrawalsUsd) || 0);
      setServerCommissionBalanceUsd(Number(res.commissionBalanceUsd) || 0);
      if (res.creditBalanceUsd != null) {
        setServerCreditBalanceUsd(Number(res.creditBalanceUsd) || 0);
      }
      setCustomer((cur) =>
        cur?.id === cid
          ? { ...cur, customerBalanceUsd: res.internalSignedUsd || res.customerBalanceUsd }
          : cur,
      );
      return res.orders;
    } finally {
      setSharedOrdersRefreshing(false);
    }
  }

  async function reloadIntakeOrdersPreserveForm(): Promise<PaymentIntakeOrderRow[] | null> {
    return refreshSharedPaymentIntakeOrders();
  }

  function finishOrderEditAndRestore(refresh: boolean) {
    setOrderEditId(null);
    const reopen = reopenMethodControlAfterOrderEditRef.current;
    reopenMethodControlAfterOrderEditRef.current = false;
    if (refresh) {
      dispatchOrdersListRefresh();
      void (async () => {
        await refreshSharedPaymentIntakeOrders();
        if (reopen) setMethodControlOpen(true);
      })();
      return;
    }
    if (reopen) setMethodControlOpen(true);
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

  /** יתרה לתצוגה — מוקדמת מהתשלום בטופס; כשאין סכום = יתרת DB */
  function orderRowLedgerBalance(row: PaymentIntakeMatchResult): number {
    return row.remainingAmount;
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

  useEffect(() => {
    if (displayedPaymentCode) setPaymentCodeSearch(displayedPaymentCode);
  }, [displayedPaymentCode]);

  const onPaymentCodeSearchSubmit = useCallback(() => {
    void loadPaymentByCode(paymentCodeSearch);
  }, [loadPaymentByCode, paymentCodeSearch]);

  const onStartNewCapturePayment = useCallback(() => {
    startNewCapturePayment();
  }, [startNewCapturePayment]);

  const paymentNavigatorProps = useMemo(
    () => ({
      searchValue: paymentCodeSearch,
      onSearchValueChange: setPaymentCodeSearch,
      onSearchSubmit: onPaymentCodeSearchSubmit,
      searchBusy: paymentCodeSearchBusy,
      searchPlaceholder: displayedPaymentCode || null,
      actionsDisabled: paymentNavLoading || saveBusy,
      onHome: onStartNewCapturePayment,
    }),
    [
      displayedPaymentCode,
      paymentNavLoading,
      saveBusy,
      paymentCodeSearch,
      paymentCodeSearchBusy,
      onStartNewCapturePayment,
      onPaymentCodeSearchSubmit,
    ],
  );
  const paymentIsCancelled = loadedPayment?.status === "CANCELLED";
  const captureReadOnly = paymentIsCancelled;
  const canCancelSavedPayment =
    Boolean(savedCapturePaymentId) && !paymentIsCancelled && cancelRequestHint.status !== "PENDING";

  async function refreshCancelRequestHint(paymentId: string) {
    const hint = await getPaymentCancelRequestHintAction(paymentId);
    setCancelRequestHint(hint);
  }

  async function submitCancelRequest() {
    if (!savedCapturePaymentId || cancelPaymentBusy) return;
    const reason = cancelReasonDraft.trim();
    if (reason.length < 3) {
      setSaveErr("יש להזין סיבת ביטול (לפחות 3 תווים)");
      return;
    }
    setCancelPaymentBusy(true);
    setSaveErr(null);
    try {
      const res = await createInvoiceCancelRequestAction({
        paymentId: savedCapturePaymentId,
        cancelReason: reason,
        notes: cancelNotesDraft.trim() || null,
      });
      if (!res.ok) {
        setSaveErr(res.error);
        onToast(res.error);
        return;
      }
      setCancelPaymentOpen(false);
      setCancelReasonDraft("");
      setCancelNotesDraft("");
      if (res.mode === "immediate") {
        await loadPayment(savedCapturePaymentId, { forceNetwork: true });
        setCancelRequestHint({ status: "none" });
        onToast("החשבונית בוטלה");
        return;
      }
      setCancelRequestHint({ status: "PENDING", requestId: res.requestId });
      onToast("בקשת ביטול נשלחה למנהל — החשבונית נשארת פעילה");
    } finally {
      setCancelPaymentBusy(false);
    }
  }

  function badgeKeyFinish(e: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
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
              <PaymentNavigator {...paymentNavigatorProps} />
              <div className="payment-modal-rate-strip-rates">
                {canEditOrders ? (
                  <button
                    type="button"
                    className="payment-upd-auto-adjust-btn payment-upd-auto-adjust-btn--top"
                    onClick={() => setAutoAdjustOpen(true)}
                    disabled={!customer || captureReadOnly}
                    title={!customer ? "יש לבחור לקוח לפני ביצוע התאמה" : "התאמה אוטומטית"}
                  >
                    ⚙ התאמה אוטומטית
                  </button>
                ) : null}
                <span className="payment-modal-rate-strip-lead">תאריך ביצוע קליטת תשלום:</span>
                <input
                  type="date"
                  dir="ltr"
                  className="payment-modal-rate-strip-inp payment-modal-rate-strip-inp--date"
                  value={intakeDateYmd}
                  onChange={(e) => {
                    const v = e.target.value;
                    setIntakeDateYmd(v);
                    setPaymentDateYmd(v);
                  }}
                  aria-label="תאריך ביצוע קליטת תשלום"
                  title="תאריך קבלת הכסף בפועל — לבקרת קופה בלבד"
                  readOnly={captureReadOnly}
                />
                <span className="payment-modal-rate-strip-lead">שער דולר:</span>
                <input
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  className="payment-modal-rate-strip-inp"
                  value={dollarRate}
                  onChange={(e) => { dollarRateTouchedRef.current = true; setDollarRate(sanitizeMoneyInput(e.target.value)); }}
                  aria-label="שער דולר"
                  readOnly={captureReadOnly}
                />
                <PaymentDocumentRateIcons
                  entityType="PAYMENT"
                  entityId={docEntityId}
                  disabled={captureReadOnly}
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
                  readOnly={captureReadOnly}
                />
              </div>
            </div>
            {customerWorkspaceLoading ? (
              <p className="payment-modal-hint payment-modal-hint--top payment-modal-hint--workspace-load" role="status">
                <span className="payment-modal-save-spinner" aria-hidden />
                טוען נתוני לקוח…
              </p>
            ) : null}
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
                        <Search size={16} strokeWidth={1.75} aria-hidden />
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
                        onKeyDown={(e) => handleCustomerFieldKeyDown("code", e)}
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
                        <Search size={16} strokeWidth={1.75} aria-hidden />
                      </button>
                    </span>
                    <input
                      type="text"
                      autoComplete="off"
                      className="payment-modal-cust-inp payment-modal-cust-inp--name"
                      value={draftCustomer.displayName}
                      onChange={(e) => onDraftCustomerChange("displayName", e.target.value)}
                      onKeyDown={(e) => handleCustomerFieldKeyDown("displayName", e)}
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
                      onKeyDown={(e) => handleCustomerFieldKeyDown("nameEn", e)}
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
                        <Search size={16} strokeWidth={1.75} aria-hidden />
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
                      onKeyDown={(e) => handleCustomerFieldKeyDown("nameAr", e)}
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
                    onKeyDown={(e) => handleCustomerFieldKeyDown("phone", e)}
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
                        <Search size={16} strokeWidth={1.75} aria-hidden />
                      </button>
                    </span>
                    <input
                      type="text"
                      autoComplete="off"
                      className="payment-modal-cust-inp"
                      dir="ltr"
                      value={draftCustomer.index}
                      onChange={(e) => onDraftCustomerChange("index", e.target.value)}
                      onKeyDown={(e) => handleCustomerFieldKeyDown("index", e)}
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
                    <BarChart3 size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
                {custDdOpen && customerHits.length > 0 ? (
                  <ul className="payment-modal-dd payment-modal-dd--custstrip" role="listbox">
                    {customerHits.map((row, idx) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={`payment-modal-dd-item${idx === custActiveIndex ? " is-active" : ""}`}
                          aria-selected={idx === custActiveIndex}
                          onMouseEnter={() => setCustActiveIndex(idx)}
                          onMouseDown={() => void pickCustHit(row)}
                        >
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
                {custSearchNoHits && !loadingCustomer && !custSearching && !customerCodeEnterBusy ? (
                  <p className="payment-modal-cust-notfound" role="status">
                    {lastEditedFieldRef.current === "code"
                      ? "לא נמצא לקוח עם קוד זה"
                      : "לא נמצאו לקוחות מתאימים"}
                  </p>
                ) : null}
                {customer ? (
                  <div className="payment-modal-cust-summary" role="status" aria-live="polite">
                    <div className="payment-modal-cust-summary__identity">
                      <span className="payment-modal-cust-name">{customer.displayName}</span>
                      {customerWorkspaceLoading ? (
                        <span className="payment-modal-cust-summary-loading">טוען נתוני לקוח…</span>
                      ) : (
                        <>
                          <span className="payment-modal-cust-summary__sep" aria-hidden>
                            |
                          </span>
                          <span>{orders.length} הזמנות</span>
                          {customer.customerCode ? (
                            <>
                              <span className="payment-modal-cust-summary__sep" aria-hidden>
                                |
                              </span>
                              <span className="payment-modal-cust-summary__code" dir="ltr">
                                #{customer.customerCode}
                              </span>
                            </>
                          ) : null}
                        </>
                      )}
                    </div>
                    {!customerWorkspaceLoading ? (
                      <div
                        className="payment-modal-cust-summary__totals"
                        dir="rtl"
                        aria-label="מחשבון לקוח"
                      >
                        <div className="payment-modal-cust-summary__total payment-modal-cust-summary__total--charges">
                          <DollarSign size={16} strokeWidth={1.75} aria-hidden />
                          <span className="payment-modal-cust-summary__total-k">חייבים:</span>
                          <strong className="payment-modal-cust-summary__total-v" dir="ltr">
                            {fmtUsdDisplay(liveIntakeTotals.chargesUsd)}
                          </strong>
                        </div>
                        <div className="payment-modal-cust-summary__total payment-modal-cust-summary__total--payments">
                          <CreditCard size={16} strokeWidth={1.75} aria-hidden />
                          <span className="payment-modal-cust-summary__total-k">תשלומים:</span>
                          <strong className="payment-modal-cust-summary__total-v" dir="ltr">
                            {fmtUsdDisplay(liveIntakeTotals.paymentsUsd)}
                          </strong>
                        </div>
                        {liveIntakeTotals.withdrawalsUsd > 0.01 ? (
                          <div className="payment-modal-cust-summary__total payment-modal-cust-summary__total--withdrawals">
                            <TrendingDown size={16} strokeWidth={1.75} aria-hidden />
                            <span className="payment-modal-cust-summary__total-k">משיכה מחוב:</span>
                            <strong className="payment-modal-cust-summary__total-v" dir="ltr">
                              -{fmtUsdDisplay(liveIntakeTotals.withdrawalsUsd)}
                            </strong>
                          </div>
                        ) : null}
                        <div className="payment-modal-cust-summary__total payment-modal-cust-summary__total--commissions">
                          <TrendingDown size={16} strokeWidth={1.75} aria-hidden />
                          <span className="payment-modal-cust-summary__total-k">עמלות:</span>
                          <button
                            type="button"
                            className={[
                              "payment-modal-cust-summary__total-v",
                              "payment-modal-cust-summary__commission-btn",
                              displayCommissionBalanceUsd < -0.01
                                ? "payment-modal-cust-summary__total-v--commission-neg"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            dir="ltr"
                            onClick={() => setCommissionPopoverOpen(true)}
                            aria-label="פירוט תנועות עמלה"
                            disabled={!customer?.id}
                          >
                            {displayCommissionBalanceUsd < -0.01
                              ? `${fmtUsdDisplay(Math.abs(displayCommissionBalanceUsd))}-`
                              : fmtUsdDisplay(displayCommissionBalanceUsd)}
                          </button>
                        </div>
                        <div
                          className={[
                            "payment-modal-cust-summary__total",
                            "payment-modal-cust-summary__total--balance",
                            customerFinancial.tone === "credit"
                              ? "payment-modal-cust-summary__total--balance-credit"
                              : customerFinancial.tone === "debt"
                                ? "payment-modal-cust-summary__total--balance-debt"
                                : "payment-modal-cust-summary__total--balance-zero",
                          ].join(" ")}
                        >
                          <Scale size={16} strokeWidth={1.75} aria-hidden />
                          <span className="payment-modal-cust-summary__total-k">
                            {customerBalanceResetPending ? "חוב פתוח לאחר איפוס" : "חוב פתוח"}:
                          </span>
                          <strong className="payment-modal-cust-summary__total-v" dir="ltr">
                            {fmtUsdDisplay(intakeStripOpenDebtUsd)}
                          </strong>
                        </div>
                        <div className="payment-modal-cust-summary__total payment-modal-cust-summary__total--credit">
                          <Wallet size={16} strokeWidth={1.75} aria-hidden />
                          <span className="payment-modal-cust-summary__total-k">יתרת זכות:</span>
                          <button
                            type="button"
                            className="payment-modal-cust-summary__total-v payment-modal-cust-summary__credit-btn"
                            dir="ltr"
                            onClick={() => setCreditPopoverOpen(true)}
                            aria-label="פירוט יתרת זכות"
                            disabled={!customer?.id}
                          >
                            +{fmtUsdDisplay(displayCreditBalanceAfterApplyUsd)}
                          </button>
                          {customerHasCredit && !isHistoricalPaymentView ? (
                            <button
                              type="button"
                              className="payment-modal-cust-summary__credit-btn"
                              disabled={!canUseExistingCredit && pendingCreditApplyUsd <= 0.01}
                              onClick={() => {
                                if (pendingCreditApplyUsd > 0.01) {
                                  setBalanceResetFromCredit(false);
                                  onToast("שימוש ביתרת זכות בוטל");
                                  return;
                                }
                                if (!canUseExistingCredit) return;
                                setBalanceResetFromCredit(true);
                                onToast("יתרת זכות תנוצל בשמירת התשלום");
                              }}
                              aria-label={
                                pendingCreditApplyUsd > 0.01
                                  ? "בטל שימוש ביתרת זכות"
                                  : canUseExistingCredit
                                    ? `השתמש ביתרת זכות $${fmtUsdDisplay(creditAvailableForResetUsd)}`
                                    : "אין סכום לכיסוי ביתרת זכות"
                              }
                            >
                              {pendingCreditApplyUsd > 0.01 ? "בטל" : "+ השתמש"}
                            </button>
                          ) : null}
                        </div>
                        {customerFinancial.tone !== "credit" ? (
                        <div
                          className={[
                            "payment-modal-cust-summary__total",
                            "payment-modal-cust-summary__total--status",
                            `payment-modal-cust-summary__total--status-${customerFinancial.tone}`,
                          ].join(" ")}
                        >
                          <span className="payment-modal-cust-summary__total-k">מצב:</span>
                          <strong className="payment-modal-cust-summary__total-v" dir="ltr">
                            {customerFinancial.headline}
                          </strong>
                        </div>
                        ) : null}
                      </div>
                    ) : null}
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
                    onChange={(e) => {
                      const v = e.target.value;
                      setPaymentDateYmd(v);
                      setIntakeDateYmd(v);
                    }}
                    onBlur={() => setEditingBadge(null)}
                    onKeyDown={badgeKeyFinish}
                    aria-label="תאריך ביצוע תשלום"
                  />
                ) : (
                  <button type="button" className="payment-modal-inline-static" onClick={() => setEditingBadge("date")} aria-label="תאריך ביצוע תשלום — עריכה">
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

                <div className="payment-modal-week-row" dir="ltr" aria-label="שבוע קליטת תשלום">
                  <AhWeekNavPrevButton
                    className="payment-modal-week-arrow"
                    variant="angle"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => shiftIntakeWeek(-1)}
                  />
                  <button
                    type="button"
                    className="payment-modal-week-arrow"
                    aria-label="שבוע קליטה לפי בית"
                    title="חזרה לשבוע העבודה הנבחר"
                    disabled={
                      normalizeAhWeekCode(intakeWeekCode) ===
                      normalizeAhWeekCode(defaultPaymentIntakeWeekCode(globalWeek))
                    }
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={goToCurrentWorkWeek}
                  >
                    <Home size={16} strokeWidth={1.75} aria-hidden />
                  </button>
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
                      applyIntakeWeekCode(toWeekCode(num), { reloadOrders: true });
                    }}
                    onBlur={() => {
                      const curRaw = weekDraft.trim().toUpperCase();
                      const num = parseWeekNumber(curRaw);
                      if (num == null) {
                        setWeekInputErr(null);
                        setWeekDraft(intakeWeekCode || defaultPaymentIntakeWeekCode(globalWeek));
                        return;
                      }
                      applyIntakeWeekCode(toWeekCode(num));
                    }}
                  />
                  <AhWeekNavNextButton
                    className="payment-modal-week-arrow"
                    variant="angle"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => shiftIntakeWeek(1)}
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

                <div className="payment-modal-week-context-hint" dir="rtl">
                  שבוע קליטת תשלום: <span dir="ltr">{intakeWeekCode}</span>
                  {" "}
                  · הזמנות לתשלום: <span dir="ltr">{orderSourceWeekCode}</span>
                  {normalizeAhWeekCode(globalWeek) ? (
                    <>
                      {" "}
                      · שבוע בית: <span dir="ltr">{globalWeek}</span>
                    </>
                  ) : null}
                </div>

                <div className="payment-modal-order-source" dir="rtl" aria-label="מקור הזמנות">
                  <span className="payment-modal-order-source__label">הזמנות:</span>
                  <span className="payment-modal-order-source__week" dir="ltr">
                    {orderSourceWeekCode}
                  </span>
                  {editingOrderSourceDate ? (
                    <input
                      type="date"
                      className="payment-modal-inline-input payment-modal-order-source__date"
                      dir="ltr"
                      autoFocus
                      value={orderSourceDateYmd}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOrderSourceDateYmd(v);
                        const cid = customer?.id?.trim();
                        if (cid) {
                          const srcWeek = orderSourceWeekForIntakeWeek(intakeWeekCode, v);
                          void loadCustomerWorkspaceInBackground(cid, srcWeek, {
                            perfLabel: "orderSourceDateChange",
                          });
                        }
                      }}
                      onBlur={() => setEditingOrderSourceDate(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape") setEditingOrderSourceDate(false);
                      }}
                      aria-label="תאריך הזמנות"
                    />
                  ) : (
                    <button
                      type="button"
                      className="payment-modal-inline-static payment-modal-order-source__date-btn"
                      dir="ltr"
                      onClick={() => setEditingOrderSourceDate(true)}
                      aria-label="תאריך הזמנות — עריכה"
                    >
                      {formatSlashDate(orderSourceDateYmd)}
                    </button>
                  )}
                </div>

              </div>
            </div>

            <div className="payment-modal-table-wrap payment-modal-table-wrap--focused">
              {customer && !customerWorkspaceLoading && false && showOpenBalanceActions ? (
                <div className="payment-open-balance-panel" dir="rtl" role="region" aria-label="יתרה פתוחה">
                  <p className="payment-open-balance-panel__lead">
                    אמצעי התשלום תואם להזמנה —
                    {orderRemainderAfterPaymentUsd > BALANCE_RESET_TOLERANCE_USD ? (
                      <>
                        {" "}
                        נותרה יתרה של{" "}
                        <strong dir="ltr">${fmtUsdDisplay(orderRemainderAfterPaymentUsd)}</strong>.
                      </>
                    ) : null}
                    {orderOverpaymentAfterPaymentUsd > BALANCE_RESET_TOLERANCE_USD ? (
                      <>
                        {" "}
                        קיים עודף תשלום של{" "}
                        <strong dir="ltr">${fmtUsdDisplay(orderOverpaymentAfterPaymentUsd)}</strong>.
                      </>
                    ) : null}{" "}
                    ניתן לשמור תשלום חלקי, לאפס יתרה, או להשתמש ביתרת זכות.
                  </p>
                  {balanceResetFromCredit && customerBalanceResetPending && pendingCreditApplyUsd > 0.01 ? (
                    <div className="payment-credit-apply-preview" role="status">
                      <div>
                        <span>נוצלה יתרת זכות:</span>
                        <strong dir="ltr">${fmtUsdDisplay(pendingCreditApplyUsd)}</strong>
                      </div>
                      <div>
                        <span>נשאר לתשלום:</span>
                        <strong dir="ltr">${fmtUsdDisplay(remainderAfterCreditApplyUsd)}</strong>
                      </div>
                    </div>
                  ) : null}
                  {viewerIsAdmin ? (
                    <div className="payment-open-balance-panel__actions">
                      {showCreditBalanceResetBtn ? (
                        <button
                          type="button"
                          className="adm-btn adm-btn--primary pm-reset-balance-btn pm-reset-balance-btn--credit"
                          onClick={() => setCreditResetConfirmOpen(true)}
                        >
                          השתמש ביתרת זכות
                        </button>
                      ) : null}
                      {showResetBalanceBtn ? (
                        <button
                          type="button"
                          className={[
                            "adm-btn",
                            "pm-reset-balance-btn",
                            customerBalanceResetPending ? "pm-reset-balance-btn--preview" : "adm-btn--ghost",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => {
                            if (customerBalanceResetPending) {
                              setCustomerBalanceResetPending(false);
                              setBalanceResetFromCredit(false);
                              onToast("תצוגת איפוס יתרה בוטלה");
                              return;
                            }
                            setResetCustomerConfirmOpen(true);
                          }}
                        >
                          {customerBalanceResetPending && !balanceResetFromCredit
                            ? "ביטול תצוגת איפוס"
                            : "איפוס יתרה"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {customer && !customerWorkspaceLoading ? (
                isHistoricalPaymentView ? (
                  <div
                    className="payment-modal-existing-banner"
                    dir="rtl"
                    role="status"
                    aria-label="תשלום קיים"
                  >
                    <span className="payment-modal-existing-badge">תשלום קיים</span>
                    <span>
                      {displayedPaymentCode ? (
                        <>
                          קוד <strong dir="ltr">{displayedPaymentCode}</strong>
                          {" · "}
                        </>
                      ) : null}
                      סה״כ שמור <strong dir="ltr">{fmtUsdDisplay(totals.totalUsd)}</strong>
                      {" · "}
                      סטטוס: בוצע
                      {customerOpenDebtDisplayUsd > 0.01 ? (
                        <>
                          {" · "}
                          חוב נוכחי <strong dir="ltr">{fmtUsdDisplay(customerOpenDebtDisplayUsd)}</strong>
                        </>
                      ) : (
                        <> · אין חוב פתוח</>
                      )}
                      {" · "}
                      יתרת זכות{" "}
                      <strong dir="ltr">+{fmtUsdDisplay(displayCreditBalanceUsd)}</strong>
                    </span>
                  </div>
                ) : (
                <div
                  className="payment-balance-summary"
                  dir="rtl"
                  role="status"
                  aria-live="polite"
                  aria-label="תצוגת יתרה לאחר שמירת התשלום"
                >
                  {showInlineShortfallResetBtn ? (
                    <>
                      <button
                        type="button"
                        className="payment-balance-summary__badge payment-balance-summary__badge-btn"
                        onClick={() => openInlineShortfallResetModal(null)}
                      >
                        איפוס יתרה
                      </button>
                      <span className="payment-balance-summary__sep" aria-hidden>
                        •
                      </span>
                    </>
                  ) : null}
                  <span className="payment-balance-summary__item payment-balance-summary__item--with-btn">
                    <span className="payment-balance-summary__k">חוב לפני התשלום:</span>
                    <AnimatedMoneyValue
                      className="payment-balance-summary__v payment-balance-summary__v--current"
                      dir="ltr"
                      value={`$${fmtUsdDisplay(openDebtAfterPaymentPreview.currentOpenBalance)}`}
                    />
                    <button
                      type="button"
                      className="payment-balance-summary__detail-btn"
                      onClick={() => setDebtBreakdownOpen(true)}
                      title="הצג פירוט חוב"
                    >
                      <FileText size={14} aria-hidden /> הצג פירוט חוב
                    </button>
                  </span>
                  <span className="payment-balance-summary__sep" aria-hidden>
                    •
                  </span>
                  <span className="payment-balance-summary__item">
                    <span className="payment-balance-summary__k">תשלום נוכחי:</span>
                    <AnimatedMoneyValue
                      className="payment-balance-summary__v payment-balance-summary__v--entered"
                      dir="ltr"
                      value={`$${fmtUsdDisplay(openDebtAfterPaymentPreview.enteredPaymentAmount)}`}
                    />
                  </span>
                  <span className="payment-balance-summary__sep" aria-hidden>
                    •
                  </span>
                  <span className="payment-balance-summary__item">
                    <span className="payment-balance-summary__k">
                      {openDebtAfterPaymentPreview.paymentBalanceDisplay.title}:
                    </span>
                    <span
                      className={[
                        "payment-balance-summary__balance-duo",
                        openDebtAfterPaymentPreview.paymentBalanceDisplay.state === "debt"
                          ? "payment-balance-summary__balance-duo--debt"
                          : openDebtAfterPaymentPreview.paymentBalanceDisplay.state === "surplus" ||
                              openDebtAfterPaymentPreview.paymentBalanceDisplay.state === "credit"
                            ? "payment-balance-summary__balance-duo--cleared"
                            : "payment-balance-summary__balance-duo--cleared",
                      ].join(" ")}
                      dir="ltr"
                    >
                      <AnimatedMoneyValue
                        className="payment-balance-summary__v payment-balance-summary__v--hero"
                        dir="ltr"
                        value={formatPaymentBalanceUsdLine(
                          openDebtAfterPaymentPreview.paymentBalanceDisplay,
                        )}
                      />
                      <AnimatedMoneyValue
                        className="payment-balance-summary__v payment-balance-summary__v--ils"
                        dir="ltr"
                        value={formatPaymentBalanceIlsLine(
                          openDebtAfterPaymentPreview.paymentBalanceDisplay,
                        )}
                      />
                    </span>
                    {openDebtAfterPaymentPreview.paymentBalanceDisplay.statusHint ? (
                      <span className="payment-balance-summary__status-hint">
                        {openDebtAfterPaymentPreview.paymentBalanceDisplay.statusHint}
                      </span>
                    ) : null}
                    {showInlineOverpaymentBtn ? (
                      <button
                        type="button"
                        className="adm-btn adm-btn--ghost pm-reset-balance-btn pm-reset-balance-btn--inline"
                        onClick={() => openInlineOverageModal(null)}
                      >
                        טיפול בתשלום יתר
                      </button>
                    ) : null}
                    {showInlineShortfallResetBtn ? (
                      <button
                        type="button"
                        className="adm-btn adm-btn--ghost pm-reset-balance-btn pm-reset-balance-btn--inline"
                        onClick={() => openInlineShortfallResetModal(null)}
                      >
                        איפוס יתרה
                      </button>
                    ) : null}
                  </span>
                </div>
                )
              ) : null}
              {intakeCorrectionRows.length > 0 ? (
                <PaymentIntakeCorrectionBanner
                  rows={intakeCorrectionRows}
                  onShowDetail={() => {
                    setIntakeDevRows(liveIntakeDevRows);
                    setIntakeDevModalOpen(true);
                  }}
                />
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
                      <th className="pm-num pm-th-total">נשאר לתשלום</th>
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
                          {customer && customerWorkspaceLoading
                            ? "טוען נתוני לקוח…"
                            : customer
                              ? "אין הזמנות ללקוח זה"
                              : "בחרו לקוח"}
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
                              <button
                                type="button"
                                className={[
                                  "pm-commission-value-btn",
                                  row.commissionHasAdjustments ? "pm-commission-value-btn--updated" : "",
                                  isCommissionResetPreview ? "pm-commission-preview pm-commission-preview--closure" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                title="פירוט עמלה"
                                onClick={() => {
                                  const full = orders.find((o) => o.id === row.id) ?? row;
                                  const base = Number(full.commissionBaseUsd ?? full.commissionUsd) || 0;
                                  const current = Number(full.commissionUsd) || 0;
                                  const adj =
                                    Number(full.commissionAdjustmentsUsd) ||
                                    Math.round((current - base) * 100) / 100;
                                  setOrderCommissionDetail({
                                    orderId: row.id,
                                    orderNumber: row.orderNumber,
                                    baseCommissionUsd: base,
                                    adjustmentsUsd: adj,
                                    currentCommissionUsd: isCommissionResetPreview
                                      ? displayCommissionUsd
                                      : current,
                                  });
                                }}
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
                                  <span dir="ltr">{fmtUsdDisplay(displayCommissionUsd)}</span>
                                )}
                                {row.commissionHasAdjustments && !isCommissionResetPreview ? (
                                  <span className="pm-commission-updated-badge">שונתה</span>
                                ) : null}
                              </button>
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
                          <td
                            dir="ltr"
                            className={[
                              "pm-num pm-num--total-usd",
                              `pm-num--bal-${ledgerSt}`,
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
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
              {customer ? (
                <div
                  className="payment-modal-orders-summary payment-modal-orders-summary--methods"
                  dir="rtl"
                  role="region"
                  aria-label="סיכום לפי אמצעי תשלום"
                >
                  <PaymentLiveSummaryCards
                    kpis={liveFormKpis}
                    openDebtUsd={customerOpenDebtDisplayUsd}
                    commissionUsd={displayCommissionBalanceUsd}
                    onOpenDebtClick={() => setDebtBreakdownOpen(true)}
                    paymentBalanceDisplay={accountStatusDisplay}
                    overpaymentUsd={paymentPreview.projectedOverpayment}
                    historicalPaymentView={isHistoricalPaymentView}
                    lines={payments}
                    rate={rateN}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <aside className="payment-modal-side payment-modal-side--compact payment-summary" dir="rtl">
            <div className="payment-modal-side-code-readonly">
              <div className="payment-modal-lbl payment-modal-lbl--micro">
                <span>קוד תשלום</span>
                {displayedPaymentCode ? (
                  <div className="payment-nav-code payment-nav-code--readonly" dir="ltr" aria-label="קוד קליטת תשלום">
                    {displayedPaymentCode}
                  </div>
                ) : paymentCodePreviewPending ? (
                  <div
                    className="payment-nav-code payment-nav-code--readonly payment-modal-code-pending"
                    dir="ltr"
                    aria-busy="true"
                    title="טוען קוד תשלום"
                  >
                    טוען קוד תשלום…
                  </div>
                ) : (
                  <div className="payment-nav-code payment-nav-code--readonly" dir="ltr">
                    —
                  </div>
                )}
              </div>
            </div>
            <div className="payment-modal-side-body">
              <div className="payment-modal-side-inner payment-modal-side-inner--payment-only">
                <div className="payment-upd-addrow">
                  <button type="button" className="payment-upd-add-btn" onClick={() => addPaymentLine()} disabled={saveBusy || captureReadOnly}>
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
                    ) : saveJustSaved ? (
                      "נשמר"
                    ) : (
                      "שמור וחדש"
                    )}
                  </button>
                  <div className="payment-upd-addrow-meta">
                    <span>מס׳ תשלומים: </span>
                    <strong>{payments.length}</strong>
                  </div>
                </div>

                {showMethodControl ? (
                  <button
                    type="button"
                    className={`payment-upd-planned-btn${methodControlRows.some((r) => r.status === "excess") ? " has-warn" : ""}${methodControlRows.some((r) => r.status === "remaining") && !hasMethodMismatchLive ? " has-remaining" : ""}`}
                    onClick={() => setMethodControlOpen(true)}
                  >
                    אמצעי תשלום מתוכננים
                    {methodControlRows.some((r) => r.status === "excess") ? (
                      <span className="payment-upd-planned-btn__warn" title="חריגה באמצעי תשלום">
                        !
                      </span>
                    ) : methodControlRows.some((r) => r.status === "remaining") && showOpenBalanceActions ? (
                      <span className="payment-upd-planned-btn__info" title="יתרה פתוחה — לא חריגה">
                        ○
                      </span>
                    ) : null}
                  </button>
                ) : null}

                <PaymentMethodControlModal
                  open={methodControlOpen && showMethodControl}
                  methodViews={methodViews}
                  orderRemainingToPayUsd={weekScopedRemainingUsd}
                  canEditOrders={canEditOrders}
                  refreshing={sharedOrdersRefreshing}
                  onClose={() => setMethodControlOpen(false)}
                  onAutoAdjust={canEditOrders ? () => setAutoAdjustOpen(true) : undefined}
                  onRefresh={() => void refreshSharedPaymentIntakeOrders()}
                  onOrderEdit={(orderId) => openOrderForEdit(orderId, { fromMethodControl: true })}
                  onOrderView={(orderId) => void openPaymentHistory(orderId)}
                />
                {customer ? (
                  <PaymentMethodAutoAdjustModal
                    open={autoAdjustOpen}
                    customerId={customer.id}
                    customerName={customer.displayName}
                    customerCode={customer.customerCode ?? null}
                    openDebtUsd={weekScopedRemainingUsd}
                    creditUsd={displayCreditBalanceUsd}
                    weekCode={orderSourceWeekCode}
                    workCountry={intakeDocumentWorkCountry}
                    exchangeRate={dollarRate}
                    draftPaymentLines={payments}
                    onClose={() => setAutoAdjustOpen(false)}
                    onApplied={async (result) => {
                      const intents = result.intents.map((intent) => ({
                        method: intent.method,
                        currency: intent.currency,
                        amountNative: intent.amountNative,
                      }));
                      setPendingAutoAdjustIntents(intents.length > 0 ? intents : null);
                      if (result.hasOverpayment && !result.surplusDisposition) {
                        console.error("[payment-intake] OVERPAYMENT_DESTINATION_MISSING", {
                          overpaymentUsd: result.overpaymentUsd,
                        });
                        setSaveErr(
                          `יש תשלום יתר של $${result.overpaymentUsd.toFixed(2)}. יש לבחור יתרת זכות או הוספה לעמלות.`,
                        );
                        return false;
                      }
                      const saved = await performSave(result.surplusDisposition, {
                        autoAdjustIntents: intents,
                      });
                      if (!saved.ok) return false;
                      setAutoAdjustOpen(false);
                      if (result.hasOverpayment && result.surplusDisposition) {
                        const destLabel =
                          result.surplusDisposition === "commission" ? "עמלות" : "יתרת זכות";
                        onToast(`תשלום יתר: $${result.overpaymentUsd.toFixed(2)} הועבר ל${destLabel}`);
                      } else if (result.affectedOrders > 0) {
                        onToast(`התאמת האמצעים נשמרה עם התשלום`);
                      }
                      const finish = finishAfterSuccessfulSaveRef.current;
                      if (finish) await finish("new", saved);
                      return true;
                    }}
                  />
                ) : null}

                <div
                  ref={paymentLinesContainerRef}
                  className="payment-upd-lines"
                  aria-label="תשלומים שנוספו"
                >
                  {payments.map((p, idx) => {
                    const ordinal = payments.length - idx;
                    const isLatest = idx === 0;
                    return (
                      <PaymentLineDualCard
                        key={p.id}
                        line={p}
                        ordinal={ordinal}
                        isLatest={isLatest}
                        showNewTag={!isExistingPayment}
                        rateN={rateN}
                        highlightInvalidChecks={highlightInvalidCheckFields}
                        firstAmountInputRef={idx === 0 ? firstAmountInputRef : undefined}
                        onUpdate={(patch) => updatePaymentLine(p.id, patch)}
                        onRemove={() => removePaymentLine(p.id)}
                        allowedMethods={allowedMethods}
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
              <div
                className="payment-upd-sticky-total payment-upd-sticky-total--basis-led payment-upd-sticky-total--current"
                aria-live="polite"
              >
                <div className="payment-upd-sticky-total-amounts">
                  <div className="payment-upd-sticky-total-lbl">
                    {isExistingPayment ? "סה״כ תשלום שמור" : "סה״כ תשלום נוכחי"}
                  </div>
                  {isExistingPayment ? (
                    <span className="payment-modal-existing-badge payment-modal-existing-badge--side">
                      תשלום קיים
                    </span>
                  ) : null}
                  <AnimatedMoneyValue
                    className="payment-upd-sticky-total-usd money-amount"
                    dir="ltr"
                    value={fmtUsdDisplay(totals.totalUsd)}
                  />
                  <AnimatedMoneyValue
                    className="payment-upd-sticky-total-ils money-amount"
                    dir="ltr"
                    value={`₪${fmtFooterAmount(rateN > 0 ? totals.totalUsd * rateN : stickyIlsEntered)}`}
                  />
                </div>
              </div>
              {cancelRequestHint.status === "PENDING" ? (
                <div className="payment-modal-cancel-pending-banner" role="status">
                  בקשת ביטול ממתינה לאישור מנהל — החשבונית נשארת פעילה
                </div>
              ) : null}
              {paymentIsCancelled ? (
                <div className="payment-modal-cancelled-banner payment-modal-cancelled-banner--invoice" role="status">
                  <span className="payment-modal-cancelled-badge">מבוטל</span>
                  חשבונית זו בוטלה — קריאה בלבד
                  {loadedPayment?.cancelReason ? (
                    <span className="payment-modal-cancelled-reason"> — {loadedPayment.cancelReason}</span>
                  ) : null}
                </div>
              ) : null}
              {saveErr ? (
                <div className="payment-modal-err payment-modal-err--sm" style={{ whiteSpace: "pre-line" }}>
                  {saveErr}
                </div>
              ) : null}
              <PaymentDocumentRateIcons
                entityType="PAYMENT"
                entityId={docEntityId}
                disabled={captureReadOnly}
                variant="labeled"
              />
              <div className="payment-modal-save-actions">
                {canCancelSavedPayment ? (
                  <button
                    type="button"
                    className="payment-cancel-payment-btn"
                    disabled={saveBusy || cancelPaymentBusy || paymentNavLoading}
                    onClick={() => setCancelPaymentOpen(true)}
                  >
                    ביטול חשבונית
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
                  ) : saveJustSaved ? (
                    "נשמר"
                  ) : (
                    "שמור תשלום"
                  )}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <PaymentShortfallAfterSaveModal
        open={shortfallModalOpen}
        remainingUsd={postSaveRemainingUsd}
        commissionBalanceUsd={postSaveCommissionBalanceUsd}
        mode={shortfallModalMode}
        saveIntent={shortfallModalSaveMode !== null}
        busy={postSaveBusyAction !== null}
        error={postSaveError}
        onDismiss={onShortfallDismiss}
        onResolve={(resolution) => void onShortfallAfterSaveResolve(resolution)}
      />
      <OrderEditModal
        orderId={orderEditId}
        financial={financial}
        onToast={onToast}
        canCreateOrders={canCreateOrders}
        canEditOrders={canEditOrders}
        onClose={() => finishOrderEditAndRestore(false)}
        onSaved={() => finishOrderEditAndRestore(true)}
      />
      <DebtBreakdownModal
        open={debtBreakdownOpen}
        customerId={customer?.id ?? null}
        country={intakeDocumentWorkCountry}
        weekCode={intakeWeekCode}
        onClose={() => setDebtBreakdownOpen(false)}
        onOrderClick={(orderId) => openWindow({ type: "orderCapture", props: { mode: "edit", orderId } })}
      />
      {creditResetConfirmOpen ? (
        <BalanceResetCreditConfirmModal
          open={creditResetConfirmOpen}
          creditUsd={creditAvailableForResetUsd}
          requiredUsd={orderRemainderAfterPaymentUsd}
          onCancel={() => setCreditResetConfirmOpen(false)}
          onConfirm={() => {
            setCreditResetConfirmOpen(false);
            setCustomerBalanceResetPending(true);
            setBalanceResetFromCredit(true);
            onToast("איפוס מתוך יתרת זכות — יוחל בשמירת התשלום");
          }}
        />
      ) : null}
      <BalanceResetConfirmModal
        open={resetCustomerConfirmOpen}
        rows={orderBalanceResetSummary.rows}
        getOrderLabel={(orderId) => {
          const order = orders.find((o) => o.id === orderId);
          return order?.orderNumber?.trim() || orderId;
        }}
        canConfirm={canApplyResetCustomerBalance}
        onCancel={() => setResetCustomerConfirmOpen(false)}
        onConfirm={() => {
          setResetCustomerConfirmOpen(false);
          setCustomerBalanceResetPending(true);
          setBalanceResetFromCredit(false);
          onToast("תצוגת איפוס יתרה — יוחל בשמירת התשלום");
        }}
      />
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
            <h4>{viewerIsAdmin ? "ביטול חשבונית" : "בקשת ביטול חשבונית"}</h4>
            <p>
              {viewerIsAdmin ? (
                <>
                  ביטול מיידי של{" "}
                  <strong dir="ltr">{displayedPaymentCode || "חשבונית זו"}</strong>. הפעולה תירשם ביומן פעילות ותעדכן
                  יתרות וכרטסת.
                </>
              ) : (
                <>
                  שליחת בקשה למנהל לביטול{" "}
                  <strong dir="ltr">{displayedPaymentCode || "חשבונית זו"}</strong>. עד לאישור — החשבונית נשארת פעילה
                  ללא שינוי ביתרות, בכרטסת או בתשלומים.
                </>
              )}
            </p>
            <label className="payment-cancel-reason-lbl">
              סיבת ביטול
              <textarea
                className="payment-cancel-reason-input"
                rows={2}
                value={cancelReasonDraft}
                onChange={(e) => setCancelReasonDraft(e.target.value)}
                disabled={cancelPaymentBusy}
              />
            </label>
            <label className="payment-cancel-reason-lbl">
              הערות
              <textarea
                className="payment-cancel-reason-input"
                rows={2}
                value={cancelNotesDraft}
                onChange={(e) => setCancelNotesDraft(e.target.value)}
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
                onClick={() => void submitCancelRequest()}
              >
                {cancelPaymentBusy
                  ? viewerIsAdmin
                    ? "מבטל…"
                    : "שולח…"
                  : viewerIsAdmin
                    ? "בטל חשבונית"
                    : "שלח בקשה למנהל"}
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
        commissionBalanceUsd={displayCommissionBalanceUsd}
        creditBalanceUsd={displayCreditBalanceUsd}
        busy={saveBusy}
        error={saveErr}
        onConfirm={(disposition) => void onOverageConfirm(disposition)}
        onEditOrder={canEditOrders ? onOverageEditOrder : undefined}
        onCancel={onOverageCancel}
      />
      <PaymentIntakeDeviationModal
        open={intakeDevModalOpen && intakeDeviationViewLive != null}
        view={intakeDevModalOpen ? intakeDeviationViewLive : null}
        rateRows={intakeDevRows}
        onClose={onIntakeDevCancel}
        onEditOrder={onIntakeDevEditOrder}
        onAutoFix={intakeDeviationViewLive?.autoFix ? onIntakeDevAutoFix : undefined}
        autoFixBusy={intakeDevAutoFixBusy}
        showEmployeeHint={!viewerIsAdmin && !canEditOrders}
      />
      <CommissionBalancePopover
        open={commissionPopoverOpen}
        customerId={customer?.id ?? null}
        customerLabel={
          customer
            ? `${customer.displayName}${customer.customerCode ? ` #${customer.customerCode}` : ""}`
            : null
        }
        previewBalanceUsd={displayCommissionBalanceUsd}
        onClose={() => setCommissionPopoverOpen(false)}
        onOpenOrderDetail={(orderId, orderNumber) => {
          setCommissionPopoverOpen(false);
          const full = orders.find((o) => o.id === orderId);
          const base = Number(full?.commissionBaseUsd ?? full?.commissionUsd) || 0;
          const current = Number(full?.commissionUsd) || 0;
          const adj =
            Number(full?.commissionAdjustmentsUsd) || Math.round((current - base) * 100) / 100;
          setOrderCommissionDetail({
            orderId,
            orderNumber,
            baseCommissionUsd: base,
            adjustmentsUsd: adj,
            currentCommissionUsd: current,
          });
        }}
        onOpenPayment={(paymentId) => {
          setCommissionPopoverOpen(false);
          openWindow({ type: "paymentsUpdated", props: { paymentId } });
        }}
      />
      <OrderCommissionDetailModal
        open={orderCommissionDetail != null}
        orderId={orderCommissionDetail?.orderId ?? null}
        orderNumber={orderCommissionDetail?.orderNumber}
        preview={
          orderCommissionDetail
            ? {
                baseCommissionUsd: orderCommissionDetail.baseCommissionUsd,
                adjustmentsUsd: orderCommissionDetail.adjustmentsUsd,
                currentCommissionUsd: orderCommissionDetail.currentCommissionUsd,
              }
            : null
        }
        onClose={() => setOrderCommissionDetail(null)}
        onOpenPayment={(paymentId) => {
          setOrderCommissionDetail(null);
          openWindow({ type: "paymentsUpdated", props: { paymentId } });
        }}
      />
      <CreditBalancePopover
        open={creditPopoverOpen}
        customerId={customer?.id ?? null}
        workCountry={intakeDocumentWorkCountry}
        previewBalanceUsd={displayCreditBalanceUsd}
        onClose={() => setCreditPopoverOpen(false)}
      />
    </>
  );
}

