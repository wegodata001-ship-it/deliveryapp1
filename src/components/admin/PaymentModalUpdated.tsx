"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PaymentMethod } from "@prisma/client";
import { logPaymentAllocationPreSave } from "@/lib/payment-allocation-debug";
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
import {
  fetchPaymentIntakeCustomerOrdersAction,
  fetchOrderPaymentHistoryAction,
  type OrderPaymentHistoryRow,
  type PaymentIntakeCustomerPayload,
  type PaymentIntakeCustomerPaymentRow,
} from "@/app/admin/payments/intake/actions";
import { sumCustomerPaymentsUsd } from "@/lib/payment-intake-customer-kpi";
import {
  buildPaymentAllocationPreview,
  orderBalanceBeforeAllocation,
} from "@/lib/payment-allocation-preview";
import { aggregateLivePaymentFormKpis } from "@/lib/payment-intake-live-kpi";
import { DocumentsPanel } from "@/components/admin/DocumentsPanel";
import { attachDraftDocumentsAction } from "@/app/admin/documents/actions";
import {
  PAYMENT_BUCKET_LABELS,
  breakdownViolationMessage,
  enforceBreakdownAgainstEntered,
  paymentMethodBucketKey,
  type EnteredBucketUsd,
  type PaymentBucketKey,
  type PlannedBucketUsd,
} from "@/lib/payment-breakdown-shared";
import { PaymentAllocationPreviewPanel } from "@/components/admin/PaymentAllocationPreviewPanel";
import { PaymentLiveSummaryCards } from "@/components/admin/PaymentLiveSummaryCards";
import { PaymentOpenDebtDetailModal } from "@/components/admin/PaymentOpenDebtDetailModal";
import {
  computePaymentIntakeLiveTotals,
  formatIntakeLiveBalanceDisplay,
  type CommissionResetOrderPreview,
} from "@/lib/payment-intake-live-calculator";
import { planCommissionDebtClosureFromNumbers } from "@/lib/commission-debt-closure";
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
import { loadFinancialSettingsForPaymentCaptureAction } from "@/app/admin/financial/actions";
import { WEGO_FINANCIAL_SETTINGS_SAVED } from "@/lib/financial-settings-bus";
import type { SerializedFinancial } from "@/lib/financial-settings";
import type { PaymentWindowProps } from "@/lib/admin-windows";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { OrderEditModal } from "@/components/admin/OrderEditModal";
import { Button } from "@/components/ui/Button";
import { BarChart3, CreditCard, DollarSign, Home, Scale, Search, TrendingDown } from "lucide-react";
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
import { isActiveWorkWeekCode } from "@/lib/active-work-week";
import { goToNextWeekNumber, goToPrevWeekNumber } from "@/lib/weeks/ah-week-nav";
import {
  defaultPaymentIntakeDateYmd,
  defaultPaymentIntakeWeekCode,
} from "@/lib/payment-intake-default-week";
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
  savePaymentUpdatedAction,
} from "@/app/admin/payments-updated/actions";
import {
  createInvoiceCancelRequestAction,
  getPaymentCancelRequestHintAction,
  type PaymentCancelRequestHint,
} from "@/app/admin/invoice-cancel-requests/actions";
import { CustomerPaymentOverageModal } from "@/components/admin/CustomerPaymentOverageModal";
import { isSmallPaymentOverageUsd } from "@/lib/payment-small-overage";
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

function toWeekCode(n: number): string {
  const nn = Math.max(1, Math.floor(n));
  return `AH-${nn}`;
}

/** תאריך תשלום לפי שבוע AH — היום בשבוע הנוכחי, אחרת תחילת השבוע */
function paymentDateYmdForWeekCode(code: string): string {
  const norm = normalizeAhWeekCode(code.trim()) ?? code.trim().toUpperCase();
  const today = new Date();
  if (norm === getWeekCodeForLocalDate(today)) return formatLocalYmd(today);
  const from = getAhWeekRange(norm)?.from ?? WORK_WEEK_RANGES[norm]?.from;
  return from ?? formatLocalYmd(today);
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
  const [loadedPayment, setLoadedPayment] = useState<PaymentEntryResponse>(() => createNewCaptureLoadedPayment(""));
  /** קוד תשלום לתצוגה בלבד — נטען ברקע, לא מעדכן את loadedPayment (מונע remount / איבוד פוקוס) */
  const [previewPaymentCode, setPreviewPaymentCode] = useState<string | null>(null);
  const [paymentCodePreviewPending, setPaymentCodePreviewPending] = useState(true);
  const [paymentDateYmd, setPaymentDateYmd] = useState(() => defaultPaymentIntakeDateYmd());
  const [paymentTimeHm, setPaymentTimeHm] = useState(() => formatLocalHm(new Date()));
  const [weekDraft, setWeekDraft] = useState(() => defaultPaymentIntakeWeekCode());
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
  const [openDebtDetailOpen, setOpenDebtDetailOpen] = useState(false);
  /** חוב פתוח — מקור יחיד מהשרת (ללא cache מקומי) */
  const [customerOpenDebtSignedUsd, setCustomerOpenDebtSignedUsd] = useState(0);
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

  /** סיכום חלוקת תשלום מורכב לכל אמצעי (איחוד על פני הזמנות מורכבות עם יתרה) */
  const compositeSummary = useMemo(() => {
    const payable = orders.filter((o) => o.isComposite && o.breakdown.length > 0 && Number(o.dbRemainingUsd) > 0.02);
    if (payable.length === 0) return [] as { method: string; label: string; plannedUsd: number; paidUsd: number; remainingUsd: number }[];
    const map = new Map<string, { method: string; label: string; plannedUsd: number; paidUsd: number; remainingUsd: number }>();
    for (const o of payable) {
      for (const b of o.breakdown) {
        const cur = map.get(b.method) ?? { method: b.method, label: b.label, plannedUsd: 0, paidUsd: 0, remainingUsd: 0 };
        cur.plannedUsd += b.plannedUsd;
        cur.paidUsd += b.paidUsd;
        cur.remainingUsd += b.remainingUsd;
        map.set(b.method, cur);
      }
    }
    return [...map.values()].map((r) => ({
      ...r,
      plannedUsd: Math.round(r.plannedUsd * 100) / 100,
      paidUsd: Math.round(r.paidUsd * 100) / 100,
      remainingUsd: Math.round(r.remainingUsd * 100) / 100,
    }));
  }, [orders]);

  const customerBalanceResetPreview = useMemo((): CommissionResetOrderPreview[] => {
    if (!customerBalanceResetPending) return [];
    const allocated = allocatePaymentAcrossOrders(
      toPaymentIntakeBases(orders),
      totals.totalUsd,
      prioritizedSet,
    );
    const surplus = roundMoney2(allocated.unallocatedUsd);
    const allocPairs = [...allocated.byOrderId.entries()].filter(([, amountUsd]) => amountUsd > 0.01);
    const lastAllocOrderId = allocPairs.length > 0 ? allocPairs[allocPairs.length - 1][0] : null;

    return orders
      .map((o) => {
        let alloc = roundMoney2(allocated.byOrderId.get(o.id) ?? 0);
        if (surplus > 0.01 && o.id === lastAllocOrderId) {
          alloc = roundMoney2(alloc + surplus);
        }
        const paidUsd = roundMoney2(Number(o.dbPaidUsd) + alloc);
        const totalUsd = Number(o.totalAmountUsd) || 0;
        return {
          id: o.id,
          totalAmountUsd: totalUsd,
          dbPaidUsd: paidUsd,
          commissionUsd: Number(o.commissionUsd) || 0,
        };
      })
      .filter((row) => Math.abs(row.totalAmountUsd - row.dbPaidUsd) > 0.01);
  }, [customerBalanceResetPending, orders, totals.totalUsd, prioritizedSet]);

  const matched = useMemo(() => {
    return matchPaymentToOrders(bases, totals.totalUsd, prioritizedSet);
  }, [bases, totals.totalUsd, prioritizedSet]);

  const paymentAllocationPreview = useMemo(
    () =>
      buildPaymentAllocationPreview(
        matched,
        totals.totalUsd,
        commissionPercentN,
        bases,
        prioritizedSet,
      ),
    [matched, totals.totalUsd, commissionPercentN, bases, prioritizedSet],
  );

  const weekReadonly = useMemo(() => weekCodeFromYmd(paymentDateYmd), [paymentDateYmd]);

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

  useEffect(() => {
    const c = weekCodeFromYmd(paymentDateYmd);
    if (c && c !== "—") setWeekDraft(c);
  }, [paymentDateYmd]);

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
      setCustomerOpenDebtSignedUsd(0);
      return;
    }
    const gen = ++customerOpenDebtFetchGenRef.current;
    const res = await fetchCustomerOpenDebtAction(cid, intakeDocumentWorkCountry);
    if (gen !== customerOpenDebtFetchGenRef.current) return;
    if (res.ok) {
      setCustomerOpenDebtSignedUsd(parseMoneyStringOrZero(res.signedBalanceUsd));
      setCustomer((cur) =>
        cur?.id === cid ? { ...cur, customerBalanceUsd: res.internalSignedUsd } : cur,
      );
    }
  }, [intakeDocumentWorkCountry]);

  useEffect(() => {
    if (!customer?.id?.trim()) setCustomerOpenDebtSignedUsd(0);
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
  const customerHasCredit = customerBalanceUsd > 0.01;
  const customerOpenDebtDisplayUsd = customerBalanceResetPending
    ? 0
    : customerOpenDebtSignedUsd > 0.01
      ? customerOpenDebtSignedUsd
      : 0;
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

  /** Part 1 — סיכום הזמנה מרכזי: סה"כ הזמנה / שווי בש"ח / שולם (DB + הקלדה) / יתרה */
  const orderSummaryForCards = useMemo(() => {
    let total = 0;
    let paidDb = 0;
    for (const o of orders) {
      total += Number(o.totalAmountUsd) || 0;
      paidDb += Number(o.dbPaidUsd) || 0;
    }
    const totalR = roundMoney2(total);
    const paid = roundMoney2(paidDb + totals.totalUsd);
    if (totalR <= 0.005 && paid <= 0.005) return null;
    const remaining = Math.max(0, roundMoney2(totalR - paid));
    const ilsValue = roundMoney2(totalR * (rateN > 0 ? rateN : 0));
    return { totalUsd: totalR, ilsValue, paidUsd: paid, remainingUsd: remaining };
  }, [orders, totals.totalUsd, rateN]);

  /**
   * בקרת "תשלום מורכב" — אכיפה אמיתית.
   * כאשר להזמנות יש חלוקת תשלום מתוכננת, אסור לשלם באמצעי שלא הוגדר,
   * ואסור לחרוג מהסכום שהוגדר לכל אמצעי. חריגה חוסמת שמירה.
   */
  const breakdownEnforcement = useMemo(() => {
    if (compositeSummary.length === 0) {
      return { active: false, violations: [] as ReturnType<typeof enforceBreakdownAgainstEntered> };
    }
    // אם קיים חוב פתוח בהזמנה שאינה מורכבת — הסכום עשוי להיות מוקצה אליה,
    // ולכן לא נאכוף חסימה (כדי לא לחסום תשלום לגיטימי). מסמנים חריגה בלבד.
    const hasNonCompositeDebt = orders.some(
      (o) => !(o.isComposite && o.breakdown.length > 0) && Number(o.dbRemainingUsd) > 0.02,
    );
    if (hasNonCompositeDebt) {
      return { active: false, violations: [] as ReturnType<typeof enforceBreakdownAgainstEntered> };
    }
    const planByBucket = new Map<PaymentBucketKey, PlannedBucketUsd>();
    for (const r of compositeSummary) {
      const bucket = paymentMethodBucketKey(r.method);
      const cur =
        planByBucket.get(bucket) ??
        { bucket, label: PAYMENT_BUCKET_LABELS[bucket], plannedUsd: 0, remainingUsd: 0 };
      cur.plannedUsd = roundMoney2(cur.plannedUsd + r.plannedUsd);
      cur.remainingUsd = roundMoney2(cur.remainingUsd + r.remainingUsd);
      planByBucket.set(bucket, cur);
    }
    const entered: EnteredBucketUsd[] = [
      { bucket: "CASH", label: PAYMENT_BUCKET_LABELS.CASH, enteredUsd: liveFormKpis.cash.totalUsd },
      { bucket: "BANK_TRANSFER", label: PAYMENT_BUCKET_LABELS.BANK_TRANSFER, enteredUsd: liveFormKpis.bankTransfer.totalUsd },
      { bucket: "CREDIT", label: PAYMENT_BUCKET_LABELS.CREDIT, enteredUsd: liveFormKpis.credit.totalUsd },
      { bucket: "CHECK", label: PAYMENT_BUCKET_LABELS.CHECK, enteredUsd: liveFormKpis.checks.totalUsd },
      { bucket: "OTHER", label: PAYMENT_BUCKET_LABELS.OTHER, enteredUsd: liveFormKpis.other.totalUsd },
    ];
    return { active: true, violations: enforceBreakdownAgainstEntered([...planByBucket.values()], entered) };
  }, [compositeSummary, liveFormKpis, orders]);

  const breakdownBlocked = breakdownEnforcement.violations.length > 0;

  /** תצוגה חיה בלבד — יתרה לאחר שמירה = חוב נוכחי − סכום בהקלדה */
  const openDebtAfterPaymentPreview = useMemo(() => {
    const currentOpenBalance = customerBalanceResetPending
      ? 0
      : customerOpenDebtSignedUsd > 0.01
        ? roundMoney2(customerOpenDebtSignedUsd)
        : 0;
    const enteredPaymentAmount = roundMoney2(totals.totalUsd);
    const remainingAfterPayment = customerBalanceResetPending
      ? 0
      : roundMoney2(Math.max(0, currentOpenBalance - enteredPaymentAmount));
    let openCommissionUsd = 0;
    for (const o of orders) {
      const rem = Math.max(0, Number(o.totalAmountUsd) - Number(o.dbPaidUsd));
      if (rem <= 0.01) continue;
      openCommissionUsd += Number(o.commissionUsd) || 0;
    }
    openCommissionUsd = roundMoney2(openCommissionUsd);
    const afterCommissionUsd = roundMoney2(openCommissionUsd - remainingAfterPayment);
    return {
      currentOpenBalance,
      enteredPaymentAmount,
      remainingAfterPayment,
      openCommissionUsd,
      afterCommissionUsd,
    };
  }, [customerBalanceResetPending, customerOpenDebtSignedUsd, totals.totalUsd, orders]);

  const intakeStripOpenDebtUsd = customerOpenDebtDisplayUsd;

  const canApplyResetCustomerBalance = useMemo(() => {
    if (customerBalanceResetPending) return true;
    const currentOpenBalance =
      customerOpenDebtSignedUsd > 0.01 ? roundMoney2(customerOpenDebtSignedUsd) : 0;
    if (currentOpenBalance <= 0.01) return false;
    const gap = roundMoney2(currentOpenBalance - totals.totalUsd);
    return Math.abs(gap) > 0.01;
  }, [customerBalanceResetPending, customerOpenDebtSignedUsd, totals.totalUsd]);

  const showResetBalanceBtn = useMemo(() => {
    if (!viewerIsAdmin || !customer) return false;
    return (
      canApplyResetCustomerBalance ||
      customerBalanceResetPending ||
      liveIntakeTotals.balanceUsd > 0.01 ||
      liveIntakeTotals.hasDebt
    );
  }, [
    viewerIsAdmin,
    customer,
    canApplyResetCustomerBalance,
    customerBalanceResetPending,
    liveIntakeTotals.balanceUsd,
    liveIntakeTotals.hasDebt,
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
    const week =
      normalizeAhWeekCode(weekCodeFromYmd(entry.paymentDateYmd)) ?? DEFAULT_WEEK_CODE;
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
    ) => {
      const cid = customerId.trim();
      if (!cid) return;

      const gen = ++customerWorkspaceGenRef.current;
      const weekForFetch = weekCode?.trim() || null;
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
        setIncludedIds(null);
        return { ordersLoadMs, ok: true as const };
      });

      const balancesP = fetchPaymentIntakeBalancesClient(cid, wc).then((res) => {
        const balancesLoadMs = Math.round(performance.now() - balancesStart);
        if (gen !== customerWorkspaceGenRef.current) return { balancesLoadMs, ok: true as const };
        setBalancesLoading(false);
        if (!res.ok) return { balancesLoadMs, ok: false as const };
        setCustomerOpenDebtSignedUsd(parseMoneyStringOrZero(String(res.openDebtSignedUsd)));
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

      void Promise.all([ordersP, balancesP, paymentsP]).then(([ordersRes, balancesRes, paymentsRes]) => {
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
    [intakeDocumentWorkCountry],
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
      const weekForFetch = opts?.weekCode?.trim() || null;
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
        setCustomer((cur) =>
          cur?.id === cid
            ? { ...cur, customerBalanceUsd: balances.internalSignedUsd || balances.customerBalanceUsd }
            : cur,
        );
      } else {
        setCustomerOpenDebtSignedUsd(parseMoneyStringOrZero(workspace.customer.customerBalanceUsd));
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
    [intakeDocumentWorkCountry, focusFirstAmountInput, loadCustomerWorkspaceInBackground],
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
      const snapshotWeek =
        normalizeAhWeekCode(weekCodeFromYmd(snap.paymentDateYmd)) ?? DEFAULT_WEEK_CODE;
      const targetCustomerId = snap.customer.id?.trim() ?? "";
      const sameCustomer = Boolean(targetCustomerId) && customer?.id === targetCustomerId;

      if (!sameCustomer) {
        custSearchGenRef.current += 1;
        setOrders([]);
        setCustomerPayments([]);
      }

      setPaymentDateYmd(snap.paymentDateYmd);
      setWeekDraft(snapshotWeek);
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
      const snapshotWeek =
        normalizeAhWeekCode(weekCodeFromYmd(snapshot.paymentDateYmd)) ?? DEFAULT_WEEK_CODE;
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
      customerOpenDebtSignedUsd,
    };
  }, [
    loadedPayment,
    displayedPaymentCode,
    customer,
    paymentDateYmd,
    paymentTimeHm,
    weekDraft,
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
    customerOpenDebtSignedUsd,
  ]);
  buildSnapshotRef.current = buildSnapshotFromCurrentState;

  const applyPaymentSnapshot = useCallback(
    (snapshot: PaymentCaptureSnapshot): boolean => {
      const pageScrollY = window.scrollY;
      const tableScroll = tableScrollRef.current?.scrollTop ?? 0;
      const snap = clonePaymentCaptureSnapshot(snapshot);

      console.log({ paymentId: snap.paymentId, paymentCode: snap.paymentCode, source: "CACHE" });
      console.log("NAV→FORM APPLIED", snap.paymentId, snap.paymentCode);

      custSearchGenRef.current += 1;
      setCommissionResetIds(snap.commissionResetIds);
      setCustomerBalanceResetPending(snap.customerBalanceResetPending);
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

        console.log("PAYMENT SEARCH", {
          paymentCode: res.paymentCode,
          paymentId: res.paymentId,
          source: "CODE",
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
      setPaymentDateYmd(paymentDateYmdForWeekCode(norm));
      if (opts?.reloadOrders && customer?.id) {
        void loadCustomerOrders(customer.id, { silent: true, weekCode: norm });
      }
    },
    [customer?.id, loadCustomerOrders],
  );

  const shiftIntakeWeek = useCallback(
    (delta: -1 | 1) => {
      const cur =
        parseWeekNumber(weekDraft) ??
        parseWeekNumber(weekSelectValue) ??
        parseWeekNumber(DEFAULT_WEEK_CODE) ??
        1;
      const num = delta === -1 ? goToPrevWeekNumber(cur) : goToNextWeekNumber(cur);
      applyIntakeWeekCode(toWeekCode(num), { reloadOrders: true });
    },
    [weekDraft, weekSelectValue, applyIntakeWeekCode],
  );

  const goToCurrentWorkWeek = useCallback(() => {
    applyIntakeWeekCode(DEFAULT_WEEK_CODE, { reloadOrders: true });
  }, [applyIntakeWeekCode]);

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
      setOrders([]);
      setCustomerPayments([]);
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
      const weekForLoad = normalizeAhWeekCode(weekDraft.trim()) ?? intakeWeekCode;
      logPaymentCapturePerf({
        label: "customerRender",
        renderMs: Math.round(performance.now() - renderStart),
      });
      loadCustomerWorkspaceInBackground(row.id, weekForLoad);
    },
    [focusFirstAmountInput, weekDraft, intakeWeekCode, loadCustomerWorkspaceInBackground],
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
    const searchStartedAt = performance.now();
    try {
      const row = await resolveCustomerFastClient(q, { workCountry: intakeDocumentWorkCountry });
      if (row) {
        selectCustomerQuick(row, { focusAmount: true, searchStartedAt });
        return;
      }
      if (field === "code" && /^\d+$/.test(q)) {
        setCustomerHits([]);
        setCustDdOpen(false);
        setCustSearchNoHits(true);
        return;
      }
      const rows = await searchCustomersFastClient(q, { workCountry: intakeDocumentWorkCountry });
      const auto = pickAutoCustomerHit(rows, q);
      if (auto) {
        selectCustomerQuick(auto, { focusAmount: true, searchStartedAt });
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

  const startNewCapturePayment = useCallback(() => {
    custSearchGenRef.current += 1;
    setEditingBadge(null);
    setCountryOverride("AUTO");
    setCustomer(null);
    setCustomerPayments([]);
    setOrders([]);
    setDraftCustomer({ ...EMPTY_CUSTOMER_DRAFT });
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
    const defWeek = defaultPaymentIntakeWeekCode();
    setWeekDraft(defWeek);
    setWeekInputErr(null);
    setPaymentDateYmd(defaultPaymentIntakeDateYmd(defWeek));
    setPaymentTimeHm(formatLocalHm(new Date()));
    setPaymentNavLoading(false);
    setLoadErr(null);
    setSaveErr(null);
    setHighlightInvalidCheckFields(false);
    setCommissionResetIds([]);
    setCustomerBalanceResetPending(false);
    setCustomerOpenDebtSignedUsd(0);
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
    setLoadedPayment(createNewCaptureLoadedPayment(""));
    clearPaymentEntryCaches();
    baselineSigRef.current = "";
    refreshPaymentCodePreview();
    syncBaselineSoon();
    window.setTimeout(() => focusCustomerCodeInput(), 0);
  }, [
    financial,
    systemCommissionPercentStr,
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
    const snapshotWeek =
      normalizeAhWeekCode(weekCodeFromYmd(snap.paymentDateYmd)) ?? DEFAULT_WEEK_CODE;
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
      const snapshotWeek =
        normalizeAhWeekCode(weekCodeFromYmd(entry.paymentDateYmd)) ?? DEFAULT_WEEK_CODE;
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

        const searchStartedAt = performance.now();
        setCustSearching(true);
        setCustSearchField(field);
        setCustSearchNoHits(false);
        try {
          const searchWc = intakeDocumentWorkCountry;
          const rows =
            field === "code" && /^\d+$/.test(q)
              ? await searchCustomerCodeExactClient(q, {
                  signal: abort.signal,
                  workCountry: searchWc,
                })
              : await searchCustomersFastClient(q, {
                  signal: abort.signal,
                  workCountry: searchWc,
                });
          if (cancelled || gen !== custSearchGenRef.current) return;

          const still = draftCustomerRef.current[lastEditedFieldRef.current].trim() === q;
          if (!still) return;

          const auto = pickAutoCustomerHit(rows, q);
          if (auto) {
            selectCustomerQuick(auto, { focusAmount: false, searchStartedAt });
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
    if (breakdownBlocked) {
      const msg = breakdownEnforcement.violations.map(breakdownViolationMessage).join("\n\n");
      setSaveErr(`לא ניתן לשמור.\n\n${msg}`);
      return { ok: false };
    }
    const forceCustomerCreditPayment = customerHasCredit;
    const allocDiag = logPaymentAllocationPreSave({
      source: "payment-modal",
      customerId: customer?.id ?? null,
      customerLoaded: Boolean(customer),
      ordersLoading,
      ordersCount: orders.length,
      paymentAmountUsd: totals.totalUsd,
      selectedOrderIds: includedIds,
      weekCode: intakeWeekCode,
      bases,
      prioritizedOrderIds: prioritizedSet,
      forceCustomerCreditPayment,
      lastCustomerSearchExactOnly: lastEditedFieldRef.current === "code",
      custSearchNoHits,
    });
    const { byOrderId, unallocatedUsd } =
      forceCustomerCreditPayment && totals.totalUsd > 0.02
        ? { byOrderId: new Map<string, number>(), unallocatedUsd: totals.totalUsd }
        : {
            byOrderId: new Map(allocDiag.allocationTargets.map((t) => [t.orderId, t.amountUsd])),
            unallocatedUsd: allocDiag.unallocatedUsd,
          };
    const hasAlloc = allocDiag.allocationTargets.length > 0;
    if (!hasAlloc && !((saveSurplusAsCredit || forceCustomerCreditPayment) && unallocatedUsd > 0.02)) {
      setSaveErr("אין יעד להקצאה");
      return { ok: false };
    }
    if (totals.totalUsd > 0.02 && unallocatedUsd > 0.02 && !saveSurplusAsCredit && !forceCustomerCreditPayment) {
      if (!isSmallPaymentOverageUsd(unallocatedUsd)) {
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
    }
    setSaveBusy(true);
    const receivedTodaySave = isTodayYmd(paymentDateYmd);
    const hm = (paymentTimeHm || "").trim() || formatLocalHm(new Date());
    const weekForSave = intakeWeekCode;
    const saveStart = performance.now();
    const res = await savePaymentUpdatedAction({
      customerId: customer.id,
      receivedToday: receivedTodaySave,
      paymentDateYmd: receivedTodaySave ? formatLocalYmd(new Date()) : paymentDateYmd,
      paymentTimeHm: hm,
      weekCode: weekForSave,
      workCountry: captureWorkCountry,
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
    if (saveJustSavedTimerRef.current != null) {
      window.clearTimeout(saveJustSavedTimerRef.current);
    }
    setSaveJustSaved(true);
    saveJustSavedTimerRef.current = window.setTimeout(() => {
      setSaveJustSaved(false);
      saveJustSavedTimerRef.current = null;
    }, 2000);
    onToast("התשלום נשמר");

    const refreshStart = performance.now();
    const savedDateYmd = receivedTodaySave ? formatLocalYmd(new Date()) : paymentDateYmd;
    const resetIds = [...commissionResetIds];
    setOrders((cur) =>
      cur.map((o) => {
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
          const newRem = roundMoney2(Math.max(0, total - newPaid));
          row = {
            ...row,
            dbPaidUsd: newPaid.toFixed(2),
            dbRemainingUsd: newRem.toFixed(2),
            lastPaymentDateYmd: savedDateYmd,
            status: debtStatus(newPaid, total),
          };
        }
        return row;
      }),
    );
    setCommissionResetIds([]);
    setCustomerBalanceResetPending(false);
    setIncludedIds(null);
    setCustomer((cur) => (cur ? { ...cur, customerBalanceUsd: res.saved.customerBalanceUsd } : cur));
    setCustomerOpenDebtSignedUsd(Math.max(0, openDebtAfterPaymentPreview.remainingAfterPayment));

    const savedPaymentId = res.saved.primaryPaymentId?.trim() ?? savedCapturePaymentId ?? "";
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
    setDocDraftKey(makeDocDraftKey());
    syncBaselineSoon();
    focusFirstAmountInput();
    refreshPaymentCodePreview();
  }

  async function finishSaveAndNew(savedCode: string) {
    finishSaveAndNewOptimistic(savedCode);
  }

  /**
   * "שמור וחדש" — שומר את התשלום, מעדכן יתרות מקומית, ומאפס את הטופס
   * לתשלום הבא — בלי רענון מלא של המערכת.
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
              <PaymentNavigator {...paymentNavigatorProps} />
              <div className="payment-modal-rate-strip-rates">
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
                        <Search size={16} strokeWidth={1.75} aria-hidden />
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
                    <BarChart3 size={16} strokeWidth={1.75} aria-hidden />
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
                          <span className="payment-modal-cust-summary__total-k">חיובים:</span>
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
                        <div className="payment-modal-cust-summary__total payment-modal-cust-summary__total--commissions">
                          <TrendingDown size={16} strokeWidth={1.75} aria-hidden />
                          <span className="payment-modal-cust-summary__total-k">עמלות:</span>
                          <strong
                            className={[
                              "payment-modal-cust-summary__total-v",
                              liveIntakeTotals.commissionsUsd < -0.01
                                ? "payment-modal-cust-summary__total-v--commission-neg"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            dir="ltr"
                          >
                            {liveIntakeTotals.commissionsUsd < -0.01
                              ? `${fmtUsdDisplay(Math.abs(liveIntakeTotals.commissionsUsd))}-`
                              : fmtUsdDisplay(liveIntakeTotals.commissionsUsd)}
                          </strong>
                        </div>
                        <div
                          className={[
                            "payment-modal-cust-summary__total",
                            "payment-modal-cust-summary__total--balance",
                            customerBalanceResetPending || intakeStripOpenDebtUsd <= 0.01
                              ? customerOpenDebtSignedUsd < -0.01
                                ? "payment-modal-cust-summary__total--balance-credit"
                                : "payment-modal-cust-summary__total--balance-zero"
                              : "payment-modal-cust-summary__total--balance-debt",
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
                    onClick={() => shiftIntakeWeek(-1)}
                  />
                  <button
                    type="button"
                    className="payment-modal-week-arrow"
                    aria-label="שבוע נוכחי"
                    title="שבוע נוכחי"
                    disabled={isActiveWorkWeekCode(intakeWeekCode)}
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
                      setWeekDraft(weekReadonly !== "—" ? weekReadonly : globalWeek);
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

              </div>
            </div>

            <div className="payment-modal-table-wrap payment-modal-table-wrap--focused">
              {customer && !customerWorkspaceLoading ? (
                <div
                  className="payment-balance-summary"
                  dir="rtl"
                  role="status"
                  aria-live="polite"
                  aria-label="תצוגת יתרה לאחר שמירת התשלום"
                >
                  {showResetBalanceBtn ? (
                    <>
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
                      <span className="payment-balance-summary__sep" aria-hidden>
                        •
                      </span>
                    </>
                  ) : null}
                  <span className="payment-balance-summary__item">
                    <span className="payment-balance-summary__k">חוב נוכחי:</span>
                    <AnimatedMoneyValue
                      className="payment-balance-summary__v payment-balance-summary__v--current"
                      dir="ltr"
                      value={`$${fmtUsdDisplay(openDebtAfterPaymentPreview.currentOpenBalance)}`}
                    />
                  </span>
                  <span className="payment-balance-summary__sep" aria-hidden>
                    •
                  </span>
                  <span className="payment-balance-summary__item">
                    <span className="payment-balance-summary__k">סכום תשלום בהקלדה:</span>
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
                    <span className="payment-balance-summary__k">יתרה לאחר שמירה:</span>
                    <AnimatedMoneyValue
                      className={[
                        "payment-balance-summary__v",
                        openDebtAfterPaymentPreview.remainingAfterPayment > 0.01
                          ? "payment-balance-summary__v--debt"
                          : openDebtAfterPaymentPreview.remainingAfterPayment < -0.01
                            ? "payment-balance-summary__v--credit"
                            : "payment-balance-summary__v--cleared",
                      ].join(" ")}
                      dir="ltr"
                      value={`$${fmtUsdDisplay(openDebtAfterPaymentPreview.remainingAfterPayment)}`}
                    />
                  </span>
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
                        const balanceBefore = orderBalanceBeforeAllocation(row);
                        const showBalancePreview =
                          paymentAllocationPreview.show &&
                          !isCommissionResetPreview &&
                          (balanceBefore > 0.02 || row.allocationUsd > 0.02);
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
                            showBalancePreview && row.allocationUsd > 0.02
                              ? "payment-modal-tr--alloc-preview"
                              : "",
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
                          <td
                            dir="ltr"
                            className={[
                              "pm-num pm-num--total-usd",
                              `pm-num--bal-${ledgerSt}`,
                              showBalancePreview ? "pm-num--bal-alloc-preview" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {showBalancePreview ? (
                              <div className="pm-balance-alloc-preview" aria-label="תצוגת הקצאה לפני שמירה">
                                <div className="pm-balance-alloc-preview__row">
                                  <span className="pm-balance-alloc-preview__k">לפני</span>
                                  <span className="pm-balance-alloc-preview__v">{fmtUsdDisplay(balanceBefore)}</span>
                                </div>
                                {row.allocationUsd > 0.02 ? (
                                  <div className="pm-balance-alloc-preview__row pm-balance-alloc-preview__row--alloc">
                                    <span className="pm-balance-alloc-preview__k">מוקצה</span>
                                    <span className="pm-balance-alloc-preview__v">{fmtUsdDisplay(row.allocationUsd)}</span>
                                  </div>
                                ) : null}
                                <div className="pm-balance-alloc-preview__row pm-balance-alloc-preview__row--after">
                                  <span className="pm-balance-alloc-preview__k">אחרי</span>
                                  <strong className="pm-balance-alloc-preview__v">{fmtUsdDisplay(ledgerBal)}</strong>
                                </div>
                              </div>
                            ) : (
                              fmtUsdDisplay(ledgerBal)
                            )}
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
                    orderSummary={orderSummaryForCards}
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
                      if (!saveBusy && customer && !breakdownBlocked) void onSaveAndNew();
                    }}
                    disabled={saveBusy || !customer || paymentIsCancelled || breakdownBlocked}
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

                {compositeSummary.length > 0 ? (
                  <div className="payment-upd-composite" dir="rtl">
                    <div className="payment-upd-composite-title">
                      <span>אמצעי תשלום מתוכננים</span>
                      {orders.some((o) => o.hasMethodDeviation) ? (
                        <span className="payment-upd-deviation-badge" title="שולם בפועל באמצעי ששונה מהמתוכנן">
                          חריגת אמצעי תשלום
                        </span>
                      ) : null}
                    </div>
                    <table className="payment-upd-composite-tbl">
                      <thead>
                        <tr>
                          <th>סוג</th>
                          <th>תוכנן</th>
                          <th>שולם</th>
                          <th>נותר</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compositeSummary.map((r) => (
                          <tr key={r.method}>
                            <td>{r.label}</td>
                            <td dir="ltr">${r.plannedUsd.toFixed(2)}</td>
                            <td dir="ltr">${r.paidUsd.toFixed(2)}</td>
                            <td dir="ltr" className={r.remainingUsd > 0.02 ? "payment-upd-composite-rem" : "payment-upd-composite-done"}>
                              ${r.remainingUsd.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {breakdownBlocked ? (
                      <div className="payment-upd-composite-block" role="alert">
                        <div className="payment-upd-composite-block-title">לא ניתן לשמור — חריגה מחלוקת התשלום</div>
                        {breakdownEnforcement.violations.map((v) => (
                          <div className="payment-upd-composite-block-item" key={v.bucket}>
                            {breakdownViolationMessage(v).split("\n").map((ln, i) => (
                              <div key={i}>{ln}</div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="payment-upd-composite-hint">
                        החלוקה נאכפת — לא ניתן לשלם באמצעי שלא הוגדר בהזמנה או לחרוג מהסכום שהוגדר לכל אמצעי.
                      </div>
                    )}
                  </div>
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

                {customer ? <PaymentAllocationPreviewPanel preview={paymentAllocationPreview} /> : null}

                {customer ? (
                  <DocumentsPanel
                    key={docEntityId}
                    entityType="PAYMENT"
                    entityId={docEntityId}
                    title="מסמכים מצורפים"
                    selfResolvePermissions
                  />
                ) : null}

              </div>
            </div>

            <div className="payment-modal-side-sticky payment-summary-stack payment-summary-stack--v2">
              <div
                className="payment-upd-sticky-total payment-upd-sticky-total--basis-led payment-upd-sticky-total--current"
                aria-live="polite"
              >
                <div className="payment-upd-sticky-total-amounts">
                  <div className="payment-upd-sticky-total-lbl">סה״כ תשלום נוכחי</div>
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
                  disabled={saveBusy || !customer || paymentIsCancelled || breakdownBlocked}
                  onClick={() => void onSaveAndClose()}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    if (!saveBusy && customer && !breakdownBlocked) void onSaveAndClose();
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

      <OrderEditModal
        orderId={orderEditId}
        financial={financial}
        onToast={onToast}
        canCreateOrders={canCreateOrders}
        canEditOrders={canEditOrders}
        onClose={() => setOrderEditId(null)}
        onSaved={() => {
          if (customer?.id) void loadCustomerOrders(customer.id, { silent: true, weekCode: intakeWeekCode });
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
                <strong dir="ltr">
                  ${fmtUsdDisplay(openDebtAfterPaymentPreview.currentOpenBalance)}
                </strong>
              </li>
              <li>
                סכום תשלום בהקלדה:{" "}
                <strong dir="ltr">
                  ${fmtUsdDisplay(openDebtAfterPaymentPreview.enteredPaymentAmount)}
                </strong>
              </li>
              <li>
                יתרה לאחר שמירה:{" "}
                <strong dir="ltr">
                  ${fmtUsdDisplay(openDebtAfterPaymentPreview.remainingAfterPayment)}
                </strong>
              </li>
              <li>
                עמלה נוכחית:{" "}
                <strong dir="ltr">${fmtUsdDisplay(openDebtAfterPaymentPreview.openCommissionUsd)}</strong>
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
                  {openDebtAfterPaymentPreview.afterCommissionUsd < -0.01
                    ? `${fmtUsdDisplay(Math.abs(openDebtAfterPaymentPreview.afterCommissionUsd))}-`
                    : fmtUsdDisplay(openDebtAfterPaymentPreview.afterCommissionUsd)}
                </strong>
                <span className="adm-muted-keys"> (עמלה − יתרה לאחר תשלום)</span>
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

