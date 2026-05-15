"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PaymentMethod } from "@prisma/client";
import {
  buildAllocationsFromMatch,
  computeCustomerResetBalanceMetrics,
  matchPaymentToOrders,
  toPaymentIntakeBases,
  type PaymentIntakeMatchResult,
  type PaymentIntakeOrderRow,
} from "@/lib/payment-intake";
import { fetchPaymentIntakeCustomerOrdersAction, type PaymentIntakeCustomerPayload } from "@/app/admin/payments/intake/actions";
import {
  fetchOrderForPaymentContextAction,
  previewPaymentCodeForCaptureAction,
  type CustomerSearchRow,
} from "@/app/admin/capture/actions";
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
import {
  calculatePaymentLine,
  calculateTotalBaseIls,
  calculateTotalBaseUsd,
  calculateTotals,
  DEFAULT_VAT_RATE,
  roundMoney2,
  type PaymentLine,
  type PaymentLineCheck,
  type PaymentLineCurrency,
  type PaymentLineMethod,
  type PaymentLineVatMode,
} from "@/lib/payment-updated";
import { validatePaymentCheckLines } from "@/lib/payment-checks";
import { resetCustomerOutstandingBalancesAction, savePaymentUpdatedAction } from "@/app/admin/payments-updated/actions";
import { formatVatPercentLabel } from "@/lib/vat";
import { primaryCustomerDisplayName } from "@/lib/customer-names";

const COUNTRY_BADGE_SHORT: Record<OrderCountryCode, string> = {
  TURKEY: "טורקיה",
  CHINA: "סין",
  UAE: "אמירויות",
};

type BadgeEditField = "week" | "country" | "date" | "time" | null;

type CustFieldKey = "code" | "displayName" | "nameEn" | "nameAr" | "phone" | "index";

type CustomerApiSearchRow = {
  id: string;
  customerCode: string | null;
  oldCustomerCode: string | null;
  displayName: string;
  nameHe: string | null;
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
  city: string | null;
  customerType: string | null;
};

const UUID_SEARCH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const t = s.replace(/,/g, "").replace(/\s/g, "").trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeMoneyInput(raw: string): string {
  let t = raw.replace(/[^\d.]/g, "");
  const parts = t.split(".");
  if (parts.length > 2) t = parts[0] + "." + parts.slice(1).join("");
  return t;
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

/** תצוגת סכומי USD: אלפים, 2 ספרות, תווית $ */
function fmtUsdDisplay(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtIlsDisplay(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `₪ ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** סיכום תחתון — מספרים בלבד (אלפים + 2 עשרוניות), יישור LTR */
function fmtFooterAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtRate(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

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

/** ברירת מחדל לשורת תשלום חדשה — סכום כולל מע״מ (לא משנה קליטות שמורות). */
const DEFAULT_PAYMENT_VAT_MODE: PaymentLineVatMode = "INCLUDING_VAT";

function defaultVatModeForNewLine(): PaymentLineVatMode {
  return DEFAULT_PAYMENT_VAT_MODE;
}

function createDefaultLine(): PaymentLine {
  return {
    id: newLineId(),
    amount: "",
    currency: "USD",
    vatMode: defaultVatModeForNewLine(),
    paymentMethod: "CASH",
    note: "",
  };
}

function paymentMethodLabel(m: PaymentLineMethod): string {
  if (m === "CREDIT") return "אשראי";
  if (m === "BANK_TRANSFER") return "העברה בנקאית";
  if (m === "CASH") return "מזומן";
  if (m === "CHECK") return "צ׳ק";
  return "אחר";
}

function vatModeLabel(v: PaymentLineVatMode): string {
  if (v === "EXEMPT") return "פטור ממע״מ";
  if (v === "BEFORE_VAT") return "לפני מע״מ (לא כולל)";
  return "כולל מע״מ";
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

type PaymentNavDirection = "prev" | "next";

type PaymentNavigationResponse =
  | { success: true; paymentId: string; paymentCode: string | null }
  | { success: false; edge: "first" | "last" };

type PaymentEntryResponse = {
  id: string;
  paymentCode: string | null;
  paymentNumber?: number | null;
  paymentDateYmd: string;
  paymentTimeHm: string;
  dollarRate: string | null;
  /** אחוז עמלה שנשמר בקליטה — לתצוגה בטבלה; אופציונלי בטעינה ישנה */
  commissionPercent?: string | null;
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
  const { globalWeek } = useAdminGlobal();
  const defaultRate = useMemo(() => parseFinalRate(financial), [financial]);
  const { openWindow, closeTop } = useAdminWindows();

  /**
   * פוקוס מהיר: קוד לקוח → Enter (חיפוש + בחירה) → סכום → Enter → שמור וחדש → Enter
   */
  const customerCodeInputRef = useRef<HTMLInputElement | null>(null);
  const firstAmountInputRef = useRef<HTMLInputElement | null>(null);
  const saveAndNewButtonRef = useRef<HTMLButtonElement | null>(null);

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
  const [searchTick, setSearchTick] = useState(0);
  const [customerHits, setCustomerHits] = useState<CustomerSearchRow[]>([]);
  const [customer, setCustomer] = useState<PaymentIntakeCustomerPayload | null>(null);
  const [orders, setOrders] = useState<PaymentIntakeOrderRow[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [customerCodeEnterBusy, setCustomerCodeEnterBusy] = useState(false);
  const [orderEditId, setOrderEditId] = useState<string | null>(null);

  /** קליטה שנטענה מ־GET /api/payments/entry או מעטפת קליטה חדשה עם קוד מהשרת — מקור אמת לקוד תשלום */
  const [loadedPayment, setLoadedPayment] = useState<PaymentEntryResponse | null>(null);
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

  const [dollarRate, setDollarRate] = useState(() => defaultRate.toFixed(4));
  /**
   * אחוז עמלה כללי לקליטה.
   * תצוגתי בטבלה: משפיע על עמודת "$ סכום" (לא על יתרה, לא על הקצאה, לא על מע״מ).
   * נשמר ב־Payment.commissionPercent בעת שמירת הקליטה.
   * ברירת מחדל "0".
   */
  const [commissionPercent, setCommissionPercent] = useState<string>("0");
  const commissionPercentN = useMemo(() => {
    const n = parseNum(commissionPercent);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [commissionPercent]);

  const [payments, setPayments] = useState<PaymentLine[]>(() => [createDefaultLine()]);

  const [includedIds, setIncludedIds] = useState<string[] | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  /** אחרי ניסיון שמירה שנכשל באימות צ׳יקים — מסמן שדות חסרים */
  const [highlightInvalidCheckFields, setHighlightInvalidCheckFields] = useState(false);
  const [resetCustomerConfirmOpen, setResetCustomerConfirmOpen] = useState(false);
  const [resetCustomerBusy, setResetCustomerBusy] = useState(false);
  const baselineSigRef = useRef<string>("");
  const currentSigRef = useRef<string>("");
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  /** מטמון immutable לפי id — עותק עמוק בלבד, ללא שיתוף הפניות בין ניווטים */
  const entryCacheRef = useRef<Map<string, PaymentEntryResponse>>(new Map());
  /** איפוס יתרה לאחר שמירת תשלום (כשיש תשלום בטופס) */
  const resetAfterSaveRef = useRef(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navSpinDirection, setNavSpinDirection] = useState<PaymentNavDirection | null>(null);
  const [navUnsavedOpen, setNavUnsavedOpen] = useState<PaymentNavDirection | null>(null);
  const [paymentNavAvailable, setPaymentNavAvailable] = useState<Record<PaymentNavDirection, boolean | null>>({
    prev: null,
    next: null,
  });

  const customerIdRef = useRef<string | null>(null);
  customerIdRef.current = customer?.id ?? null;

  const initialAppliedRef = useRef(false);

  const rateN = parseNum(dollarRate);

  const totals = useMemo(() => calculateTotals(payments, rateN, DEFAULT_VAT_RATE), [payments, rateN]);

  /** כרטיס ירוק: מספר ראשי = בסיס לפני מע״מ (נטו), לא סכום ברוטו אחרי מע״מ */
  const stickyBaseTotals = useMemo(
    () => ({
      usd: calculateTotalBaseUsd(payments, rateN, DEFAULT_VAT_RATE),
      ils: calculateTotalBaseIls(payments, rateN, DEFAULT_VAT_RATE),
    }),
    [payments, rateN],
  );
  const currentDraftSig = useMemo(
    () =>
      JSON.stringify({
        customerId: customer?.id ?? "",
        paymentDateYmd,
        paymentTimeHm,
        dollarRate,
        commissionPercent,
        includedIds: includedIds ?? [],
        nameEn: draftCustomer.nameEn.trim(),
        nameAr: draftCustomer.nameAr.trim(),
        phone: draftCustomer.phone.trim(),
        payments,
      }),
    [customer?.id, paymentDateYmd, paymentTimeHm, dollarRate, commissionPercent, includedIds, draftCustomer.nameEn, draftCustomer.nameAr, draftCustomer.phone, payments],
  );

  const bases = useMemo(() => toPaymentIntakeBases(orders), [orders]);

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

  const currentPaymentNavigationQuery = useMemo(() => {
    const code = loadedPayment?.paymentCode?.trim();
    if (code) {
      return `currentPaymentCode=${encodeURIComponent(code)}`;
    }
    return null;
  }, [loadedPayment?.paymentCode]);

  useEffect(() => {
    if (!currentPaymentNavigationQuery) {
      setPaymentNavAvailable({ prev: null, next: null });
      return;
    }

    let cancelled = false;
    setPaymentNavAvailable({ prev: null, next: null });
    void (async () => {
      const [prev, next] = await Promise.all([
        fetch(`/api/payments/navigation?${currentPaymentNavigationQuery}&direction=prev`),
        fetch(`/api/payments/navigation?${currentPaymentNavigationQuery}&direction=next`),
      ]);
      if (cancelled) return;
      const prevJson = prev.ok ? ((await prev.json()) as PaymentNavigationResponse) : null;
      const nextJson = next.ok ? ((await next.json()) as PaymentNavigationResponse) : null;
      if (cancelled) return;
      setPaymentNavAvailable({
        prev: prevJson == null ? null : prevJson.success,
        next: nextJson == null ? null : nextJson.success,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [currentPaymentNavigationQuery]);

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

  const intakeWeekCutoffYmd = useMemo(() => getAhWeekRange(intakeWeekCode)?.to ?? null, [intakeWeekCode]);

  const intakeWeekTableHint = useMemo(() => {
    if (!intakeWeekCutoffYmd) return null;
    return `מציג יתרות פתוחות עד סוף שבוע ${intakeWeekCode} (${formatSlashDate(intakeWeekCutoffYmd)})`;
  }, [intakeWeekCode, intakeWeekCutoffYmd]);

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

  /** סיכום מתחת לטבלה: סך עסקאות (USD), סך ששולם בפועל (DB), יתרה */
  const ordersTableFooterTotals = useMemo(() => {
    let tx = 0;
    let paidSum = 0;
    for (const row of matched) {
      const usd = row.totalAmountUsd;
      tx += Number.isFinite(usd) ? usd : 0;
      const p = row.dbPaidUsd;
      paidSum += Number.isFinite(p) ? p : 0;
    }
    const totalTransactions = roundMoney2(tx);
    const totalPaidDb = roundMoney2(paidSum);
    const remaining = roundMoney2(Math.max(0, totalTransactions - totalPaidDb));
    return { totalTransactions, totalPaidDb, remaining };
  }, [matched]);

  /** עמלות זמינות ויתרה פתוחה לפי שורות הטבלה (DB) — לא לפי סיכום שגוי */
  const resetBalanceMetrics = useMemo(() => {
    const paymentRows = bases;
    const { availableCommission, remainingAmount } = computeCustomerResetBalanceMetrics(
      paymentRows,
      commissionPercentN,
    );
    const remainingToReset = roundMoney2(Math.max(0, remainingAmount - totals.totalUsd));
    return { availableCommission, remainingAmount, remainingToReset, paymentRows };
  }, [bases, commissionPercentN, totals.totalUsd]);

  const canResetCustomerBalance = useMemo(() => {
    if (!viewerIsAdmin) return false;
    if (resetBalanceMetrics.remainingToReset <= 0.01) return false;
    return resetBalanceMetrics.availableCommission >= resetBalanceMetrics.remainingToReset - 0.01;
  }, [viewerIsAdmin, resetBalanceMetrics]);

  useEffect(() => {
    if (!customer?.id || resetBalanceMetrics.remainingAmount <= 0.01) return;
    console.log({
      availableCommission: resetBalanceMetrics.availableCommission,
      remainingAmount: resetBalanceMetrics.remainingAmount,
      remainingToReset: resetBalanceMetrics.remainingToReset,
      paymentRows: resetBalanceMetrics.paymentRows.map((row) => ({
        id: row.id,
        commissionUsd: row.commissionUsd,
        totalAmountUsd: row.totalAmountUsd,
        dbPaidUsd: row.dbPaidUsd,
        remaining: roundMoney2(Math.max(0, row.totalAmountUsd - row.dbPaidUsd)),
      })),
    });
  }, [customer?.id, resetBalanceMetrics]);

  const loadCustomerOrders = useCallback(
    async (customerId: string, opts?: { silent?: boolean; focusAmount?: boolean; weekCode?: string }): Promise<boolean> => {
      if (!opts?.silent) setLoadingCustomer(true);
      setLoadErr(null);
      const res = await fetchPaymentIntakeCustomerOrdersAction(customerId, opts?.weekCode ?? intakeWeekCode);
      if (!opts?.silent) setLoadingCustomer(false);
      if (!res.ok) {
        setCustomer(null);
        setOrders([]);
        setLoadErr(res.error);
        return false;
      }
      setCustomer(res.customer);
      setOrders(res.orders);
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
      const shouldFocusAmount = opts?.focusAmount === true || opts?.silent !== true;
      if (shouldFocusAmount) {
        window.setTimeout(() => firstAmountInputRef.current?.focus(), 60);
      }
      return true;
    },
    [intakeWeekCode],
  );

  useEffect(() => {
    if (!customer?.id) return;
    void loadCustomerOrders(customer.id, { silent: true });
  }, [customer?.id, intakeWeekCode, loadCustomerOrders]);

  const pickCustHit = useCallback(
    async (row: CustomerSearchRow) => {
      custSearchGenRef.current += 1;
      setCustDdOpen(false);
      setCustomerHits([]);
      setCustSearchNoHits(false);
      await loadCustomerOrders(row.id);
    },
    [loadCustomerOrders],
  );

  const onDraftCustomerChange = useCallback((field: CustFieldKey, value: string) => {
    lastEditedFieldRef.current = field;
    setDraftCustomer((prev) => ({ ...prev, [field]: value }));
    if (field === "phone") {
      setCustDdOpen(false);
      setCustSearchNoHits(false);
      return;
    }
    setSearchTick((n) => n + 1);
    setCustDdOpen(true);
  }, []);

  const triggerFieldSearch = useCallback((field: CustFieldKey) => {
    lastEditedFieldRef.current = field;
    setSearchTick((n) => n + 1);
    setCustDdOpen(true);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => customerCodeInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  async function resolveCustomerFromCodeFieldEnter() {
    const q = draftCustomerRef.current.code.trim();
    if (!q) return;
    if (!UUID_SEARCH_RE.test(q) && q.length < 2) {
      onToast("הזן לפחות 2 תווים לחיפוש");
      return;
    }
    custSearchGenRef.current += 1;
    lastEditedFieldRef.current = "code";
    setCustomerCodeEnterBusy(true);
    setCustSearchNoHits(false);
    try {
      const res = await fetch(`/api/customers?query=${encodeURIComponent(q)}&limit=20&page=1`);
      if (!res.ok) {
        setLoadErr("טעינת נתונים נכשלה");
        return;
      }
      const data = (await res.json()) as { customers?: CustomerApiSearchRow[] };
      const rows = data.customers ?? [];
      if (rows.length === 0) {
        setCustomerHits([]);
        setCustDdOpen(false);
        setCustSearchNoHits(true);
        return;
      }
      const hits: CustomerSearchRow[] = rows.map((r) => ({
        id: r.id,
        label: primaryCustomerDisplayName({
          nameAr: r.nameAr,
          nameEn: r.nameEn,
          nameHe: r.nameHe,
          displayName: r.displayName,
        }),
        code: r.customerCode,
        customerType: r.customerType,
        city: r.city,
        phone: r.phone,
      }));

      const uuidQuick = rows.length === 1 && UUID_SEARCH_RE.test(q.trim()) && rows[0]!.id === q.trim();
      const codeOrIndexQuick = rows.length === 1 && q.length >= 1 && q.length < 2;
      const lenOk = rows.length === 1 && q.length >= 2;

      if (rows.length === 1 && (lenOk || uuidQuick || codeOrIndexQuick)) {
        if (customerIdRef.current === hits[0]!.id) {
          setCustomerHits([]);
          setCustDdOpen(false);
          setCustSearchNoHits(false);
          window.setTimeout(() => firstAmountInputRef.current?.focus(), 40);
          return;
        }
        await loadCustomerOrders(hits[0]!.id, { silent: true, focusAmount: true });
        setCustomerHits([]);
        setCustDdOpen(false);
        setCustSearchNoHits(false);
        return;
      }

      const exactCode = rows.find((r) => (r.customerCode ?? "").trim().toLowerCase() === q.toLowerCase());
      if (exactCode) {
        if (customerIdRef.current !== exactCode.id) {
          await loadCustomerOrders(exactCode.id, { silent: true, focusAmount: true });
          setCustomerHits([]);
          setCustDdOpen(false);
          setCustSearchNoHits(false);
          return;
        }
        setCustomerHits([]);
        setCustDdOpen(false);
        window.setTimeout(() => firstAmountInputRef.current?.focus(), 40);
        return;
      }

      setCustomerHits(hits);
      setCustDdOpen(hits.length > 0);
    } catch {
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
    setCommissionPercent("0");
    setLoadErr(null);
    setSaveErr(null);
    setHighlightInvalidCheckFields(false);
    setLoadedPayment(null);
    setPaymentNavAvailable({ prev: null, next: null });
    baselineSigRef.current = "";
  }, [financial]);

  async function loadPaymentEntrySnapshot(id: string): Promise<PaymentEntryResponse | null> {
    const cached = entryCacheRef.current.get(id);
    if (cached) {
      return clonePaymentEntry(cached);
    }
    const res = await fetch(`/api/payments/entry?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const raw = (await res.json()) as PaymentEntryResponse;
    const immutable = clonePaymentEntry(raw);
    entryCacheRef.current.set(id, clonePaymentEntry(immutable));
    return clonePaymentEntry(immutable);
  }

  async function applyPaymentEntry(snapshot: PaymentEntryResponse): Promise<boolean> {
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
    setPaymentTimeHm(snap.paymentTimeHm);
    if (snap.dollarRate?.trim()) setDollarRate(snap.dollarRate.trim());
    {
      const raw = (snap.commissionPercent ?? "").trim().replace(",", ".");
      const n = raw === "" ? 0 : Number(raw);
      setCommissionPercent(Number.isFinite(n) && n > 0 ? String(n) : "0");
    }
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

  async function loadPaymentFromSavedId(id: string): Promise<boolean> {
    setSaveErr(null);
    const entry = await loadPaymentEntrySnapshot(id);
    if (!entry) {
      setSaveErr("לא ניתן לטעון קליטת תשלום");
      return false;
    }
    clearCurrentPaymentState();
    return applyPaymentEntry(entry);
  }

  function paymentCaptureIsDirty(): boolean {
    return baselineSigRef.current !== "" && baselineSigRef.current !== currentDraftSig;
  }

  async function fetchPaymentNavigationNeighbor(
    direction: PaymentNavDirection,
  ): Promise<PaymentNavigationResponse | null> {
    if (!currentPaymentNavigationQuery) return null;
    const res = await fetch(
      `/api/payments/navigation?${currentPaymentNavigationQuery}&direction=${direction}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as PaymentNavigationResponse;
  }

  async function runNavigateToPaymentId(targetId: string): Promise<boolean> {
    setSaveErr(null);
    const restoreId = savedCapturePaymentId;
    const entry = await loadPaymentEntrySnapshot(targetId);
    if (!entry) {
      onToast("לא ניתן לטעון קליטה");
      return false;
    }
    clearCurrentPaymentState();
    const ok = await applyPaymentEntry(entry);
    if (!ok && restoreId && restoreId !== targetId) {
      const prevEntry = await loadPaymentEntrySnapshot(restoreId);
      if (prevEntry) {
        clearCurrentPaymentState();
        await applyPaymentEntry(prevEntry);
      }
      onToast("טעינה נכשלה — חזרה לקליטה הקודמת");
    }
    return ok;
  }

  async function executePaymentCaptureNavigation(direction: PaymentNavDirection): Promise<void> {
    if (!currentPaymentNavigationQuery) return;
    const nav = await fetchPaymentNavigationNeighbor(direction);
    if (!nav) {
      onToast("שגיאת ניווט");
      return;
    }
    if (!nav.success) {
      if (nav.edge === "first") onToast("זוהי הקליטה הראשונה");
      else onToast("זוהי הקליטה האחרונה");
      return;
    }
    await runNavigateToPaymentId(nav.paymentId);
  }

  function requestPaymentCaptureNavigation(direction: PaymentNavDirection) {
    if (!currentPaymentNavigationQuery || isNavigating || saveBusy) return;
    if (paymentNavAvailable[direction] === false) {
      onToast(direction === "prev" ? "זוהי הקליטה הראשונה" : "זוהי הקליטה האחרונה");
      return;
    }
    if (paymentCaptureIsDirty()) {
      setNavUnsavedOpen(direction);
      return;
    }
    void (async () => {
      setIsNavigating(true);
      setNavSpinDirection(direction);
      try {
        await executePaymentCaptureNavigation(direction);
      } finally {
        setIsNavigating(false);
        setNavSpinDirection(null);
      }
    })();
  }

  function goToPreviousPayment() {
    console.log("PREV CLICK");
    requestPaymentCaptureNavigation("prev");
  }

  function goToNextPayment() {
    console.log("NEXT CLICK");
    requestPaymentCaptureNavigation("next");
  }

  function confirmNavUnsavedAndProceed() {
    const direction = navUnsavedOpen;
    if (!direction) return;
    setNavUnsavedOpen(null);
    void (async () => {
      setIsNavigating(true);
      setNavSpinDirection(direction);
      try {
        await executePaymentCaptureNavigation(direction);
      } finally {
        setIsNavigating(false);
        setNavSpinDirection(null);
      }
    })();
  }

  useEffect(() => {
    if (initialAppliedRef.current) return;
    initialAppliedRef.current = true;
    const init = initialPayment ?? {};
    void (async () => {
      const pid = init.paymentId?.trim();
      if (pid) {
        await loadPaymentFromSavedId(pid);
        return;
      }

      const pr = await previewPaymentCodeForCaptureAction();
      if (pr.ok) {
        setLoadedPayment(createNewCaptureLoadedPayment(pr.code));
        setSaveErr(null);
      } else {
        setSaveErr(pr.error);
        setLoadedPayment(createNewCaptureLoadedPayment(""));
      }

      const onum = init.orderNumber?.trim();
      const cid = init.customerId?.trim();
      if (onum) {
        const ctx = await fetchOrderForPaymentContextAction(onum);
        if (ctx.ok && ctx.data.customerId) {
          await loadCustomerOrders(ctx.data.customerId);
          const rem = Number(ctx.data.remainingUsd.replace(",", "."));
          const empty = payments.length === 1 && payments[0] && payments[0].amount === "";
          if (Number.isFinite(rem) && rem > 0.01 && empty) {
            setPayments([{ ...createDefaultLine(), amount: rem, currency: "USD", note: `סגירת חיוב הזמנה ${onum}` }]);
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
    setDollarRate(parseFinalRate(financial).toFixed(4));
    setCommissionPercent("0");
    setPaymentDateYmd(formatLocalYmd(new Date()));
    setPaymentTimeHm(formatLocalHm(new Date()));
    setSaveErr(null);
    setIsNavigating(false);
    setNavSpinDirection(null);
    setNavUnsavedOpen(null);
    setPaymentNavAvailable({ prev: null, next: null });
    void (async () => {
      const pr = await previewPaymentCodeForCaptureAction();
      if (pr.ok) {
        setLoadedPayment(createNewCaptureLoadedPayment(pr.code));
      } else {
        setSaveErr(pr.error);
        setLoadedPayment(createNewCaptureLoadedPayment(""));
      }
    })();
    syncBaselineSoon();
  }, [resetOnKey, financial]);

  useEffect(() => {
    let cancelled = false;
    const gen = ++custSearchGenRef.current;
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
            if (allEmpty) {
              setCustomer(null);
              setOrders([]);
              setLoadErr(null);
            }
          }
          return;
        }
        if (!UUID_SEARCH_RE.test(q) && q.length < 2) {
          setCustomerHits([]);
          setCustDdOpen(false);
          setCustSearchNoHits(false);
          return;
        }

        let rows: CustomerApiSearchRow[] = [];
        try {
          const res = await fetch(`/api/customers?query=${encodeURIComponent(q)}&limit=20&page=1`);
          if (!res.ok) {
            if (!cancelled && gen === custSearchGenRef.current) {
              setCustomerHits([]);
              setCustSearchNoHits(false);
              setLoadErr("טעינת נתונים נכשלה");
            }
            return;
          }
          const data = (await res.json()) as { customers?: CustomerApiSearchRow[] };
          rows = data.customers ?? [];
        } catch {
          if (!cancelled && gen === custSearchGenRef.current) {
            setCustomerHits([]);
            setCustSearchNoHits(false);
            setLoadErr("בעיה בחיבור לשרת");
          }
          return;
        }

        if (cancelled || gen !== custSearchGenRef.current) return;

        const still = draftCustomerRef.current[lastEditedFieldRef.current].trim() === q;
        if (!still) return;

        const hits: CustomerSearchRow[] = rows.map((r) => ({
          id: r.id,
          label: primaryCustomerDisplayName({
            nameAr: r.nameAr,
            nameEn: r.nameEn,
            nameHe: r.nameHe,
            displayName: r.displayName,
          }),
          code: r.customerCode,
          customerType: r.customerType,
          city: r.city,
          phone: r.phone,
        }));

        setCustSearchNoHits(rows.length === 0);

        const uuidQuick = rows.length === 1 && UUID_SEARCH_RE.test(q.trim()) && rows[0]!.id === q.trim();
        const codeOrIndexQuick =
          rows.length === 1 && (field === "code" || field === "index") && q.length >= 1 && q.length < 2;
        const lenOk = rows.length === 1 && q.length >= 2;

        if (rows.length === 1 && (lenOk || uuidQuick || codeOrIndexQuick)) {
          if (customerIdRef.current === hits[0]!.id) {
            setCustomerHits([]);
            setCustDdOpen(false);
            setCustSearchNoHits(false);
            return;
          }
          await loadCustomerOrders(hits[0]!.id);
          if (!cancelled && gen === custSearchGenRef.current) {
            setCustomerHits([]);
            setCustDdOpen(false);
            setCustSearchNoHits(false);
          }
          return;
        }

        setCustomerHits(hits);
        setCustDdOpen(hits.length > 0);
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [searchTick, loadCustomerOrders]);

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

  /**
   * "איפוס יתרה" ברמת לקוח — מנהל בלבד.
   * סוגר את כל היתרות הפתוחות לכל הזמנות הלקוח ע״י הורדה מהעמלות מהחדש לישן.
   * מעדכן את הטבלה המקומית מיידית בלי refresh.
   */
  async function applyResetCustomerBalances(): Promise<void> {
    if (!viewerIsAdmin) return;
    if (!customer) return;
    setResetCustomerBusy(true);
    setSaveErr(null);
    const res = await resetCustomerOutstandingBalancesAction({
      customerId: customer.id,
      weekCode: intakeWeekCode,
      commissionPercent: commissionPercent || "0",
    });
    setResetCustomerBusy(false);
    if (!res.ok) {
      setSaveErr(res.error);
      onToast(res.error);
      return;
    }
    const updatesById = new Map(
      res.affectedOrderUpdates.map((u) => [
        u.orderId,
        { commissionUsd: u.newCommissionUsd, totalAmountUsd: u.newTotalUsd },
      ]),
    );
    const closedSet = new Set(res.closedOrderIds);
    setOrders((prev) =>
      prev.map((row) => {
        const upd = updatesById.get(row.id);
        const isClosed = closedSet.has(row.id);
        if (!upd && !isClosed) return row;
        const next = { ...row };
        if (upd) {
          next.commissionUsd = upd.commissionUsd;
          next.totalAmountUsd = upd.totalAmountUsd;
        }
        if (isClosed) {
          next.dbPaidUsd = next.totalAmountUsd;
          next.dbRemainingUsd = "0.00";
          next.status = "paid" as const;
        }
        return next;
      }),
    );
    setIncludedIds(null);
    onToast(`יתרת הלקוח אופסה (${res.totalResetUsd}$)`);
  }

  function addLineFromOrder(row: PaymentIntakeMatchResult) {
    const remUsd = roundMoney2(Math.max(0, row.remainingAmount));
    if (remUsd <= 0.01) return;
    const onum = row.orderNumber ?? row.id.slice(0, 8);
    addPaymentLine({
      amount: remUsd,
      currency: "USD",
      paymentMethod: "CASH",
      note: `סגירת חיוב הזמנה ${onum}`,
    });
    onToast("נוסף תשלום מסגירת חיוב (ללא שמירה)");
  }

  /**
   * Helper פנימי: ביצוע השמירה בלבד (validations + server action).
   * מחזיר true אם השמירה הצליחה.
   * אין כאן side-effects של reset/reload — את זה מנהלים `onSaveAndNew` / `onSaveAndClose`.
   */
  async function performSave(): Promise<boolean> {
    setSaveErr(null);
    setHighlightInvalidCheckFields(false);
    if (!customer) {
      setSaveErr("יש לבחור לקוח");
      return false;
    }
    if (totals.totalUsd <= 0) {
      setSaveErr("יש להוסיף תשלום");
      return false;
    }
    if (rateN <= 0) {
      setSaveErr("שער דולר חייב להיות חיובי");
      return false;
    }
    const checkErr = validatePaymentCheckLines(payments);
    if (checkErr) {
      setSaveErr(checkErr);
      setHighlightInvalidCheckFields(true);
      return false;
    }
    const allocations = buildAllocationsFromMatch(bases, totals.totalUsd, prioritizedSet);
    if (allocations.length === 0) {
      setSaveErr("אין יעד להקצאה");
      return false;
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
      commissionPercent: commissionPercent || "0",
      payments,
      includedOrderIds: includedIds,
      draftNameAr: draftCustomer.nameAr.trim() || null,
      draftNameEn: draftCustomer.nameEn.trim() || null,
      draftPhone: draftCustomer.phone.trim() || null,
    });
    setSaveBusy(false);
    if (!res.ok) {
      setSaveErr(res.error);
      return false;
    }
    const remainingAfter = roundMoney2(
      matched.reduce((sum, row) => sum + Math.max(0, row.remainingAmount), 0),
    );
    if (remainingAfter <= 0.01) onToast("כל החיובים נסגרו בהצלחה");
    else onToast(`נשארו ${remainingAfter.toFixed(2)}$ פתוחים`);
    entryCacheRef.current.clear();
    if (resetAfterSaveRef.current) {
      resetAfterSaveRef.current = false;
      await applyResetCustomerBalances();
    }
    return true;
  }

  /**
   * "שמור וחדש" — שומר את התשלום הנוכחי, מאפס את הטופס,
   * וטוען מחדש את ההזמנות של הלקוח כדי שיתרת ההזמנות תתעדכן —
   * אך המודאל נשאר פתוח, מוכן לתשלום חדש.
   */
  async function onSaveAndNew() {
    const ok = await performSave();
    if (!ok || !customer) return;
    setPayments([createDefaultLine()]);
    setPaymentTimeHm(formatLocalHm(new Date()));
    const pr = await previewPaymentCodeForCaptureAction();
    if (pr.ok) {
      setLoadedPayment(createNewCaptureLoadedPayment(pr.code));
      setSaveErr(null);
    } else {
      setSaveErr(pr.error);
      setLoadedPayment(createNewCaptureLoadedPayment(""));
    }
    await loadCustomerOrders(customer.id, { silent: true });
    window.setTimeout(() => customerCodeInputRef.current?.focus(), 30);
    syncBaselineSoon();
  }

  /**
   * "שמור תשלום" — שומר את התשלום וסוגר את המודאל.
   * זהו ה־flow הסופי / רגיל.
   */
  async function onSaveAndClose() {
    const ok = await performSave();
    if (!ok) return;
    closeTop();
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

  function statusClass(s: string): string {
    if (s === "paid") return "pm-st--paid";
    if (s === "partial") return "pm-st--partial";
    return "pm-st--unpaid";
  }

  function rowStatusClass(s: string): string {
    if (s === "paid") return "payment-modal-tr--status-paid";
    if (s === "partial") return "payment-modal-tr--status-partial";
    return "payment-modal-tr--status-unpaid";
  }

  const paymentCaptureNavLabel = (loadedPayment?.paymentCode ?? "").trim();
  const navArrowsDisabled = saveBusy || isNavigating || !currentPaymentNavigationQuery;
  const prevPaymentNavDisabled = navArrowsDisabled || paymentNavAvailable.prev === false;
  const nextPaymentNavDisabled = navArrowsDisabled || paymentNavAvailable.next === false;

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
          <div
            key={
              loadedPayment
                ? `${loadedPayment.id || NEW_CAPTURE_ROW_ID}:${loadedPayment.paymentCode ?? ""}`
                : "pending"
            }
            className="payment-modal-main payment-table"
            dir="rtl"
          >
            <div className="payment-modal-rate-strip" dir="rtl">
              <span className="payment-modal-rate-strip-lead">שער דולר:</span>
              <input
                type="text"
                inputMode="decimal"
                dir="ltr"
                className="payment-modal-rate-strip-inp"
                value={dollarRate}
                onChange={(e) => setDollarRate(sanitizeMoneyInput(e.target.value))}
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
                value={commissionPercent}
                placeholder="%"
                onChange={(e) => setCommissionPercent(sanitizePercentInput(e.target.value))}
                onFocus={(e) => {
                  if (e.target.value === "0") e.target.select();
                }}
                aria-label="אחוז עמלה"
                title="מוסיף אחוז על סכומי ההזמנה בטבלה (תצוגה בלבד) — לא משנה יתרה/הקצאה/מע״מ"
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
                        className={`payment-modal-cust-inp payment-modal-cust-inp--code${customerCodeEnterBusy ? " payment-modal-cust-inp--code-busy" : ""}`}
                        dir="ltr"
                        value={draftCustomer.code}
                        onChange={(e) => onDraftCustomerChange("code", e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void resolveCustomerFromCodeFieldEnter();
                          }
                        }}
                      />
                      {customerCodeEnterBusy ? (
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
                          triggerFieldSearch("displayName");
                          window.setTimeout(() => firstAmountInputRef.current?.focus(), 80);
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
                    onFocus={() => {
                      setCustDdOpen(false);
                      setCustSearchNoHits(false);
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
                {custSearchNoHits && !loadingCustomer ? (
                  <p className="payment-modal-cust-notfound" role="status">
                    לקוח לא נמצא
                  </p>
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
                  <button
                    type="button"
                    className="payment-modal-week-arrow"
                    aria-label="שבוע קודם"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const cur = parseWeekNumber(weekDraft) ?? parseWeekNumber(weekSelectValue) ?? baseWeekNumber;
                      applyWeekNumber(cur - 1);
                      setWeekInputErr(null);
                    }}
                  >
                    ◀
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
                  <button
                    type="button"
                    className="payment-modal-week-arrow"
                    aria-label="שבוע הבא"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const cur = parseWeekNumber(weekDraft) ?? parseWeekNumber(weekSelectValue) ?? baseWeekNumber;
                      applyWeekNumber(cur + 1);
                      setWeekInputErr(null);
                    }}
                  >
                    ▶
                  </button>
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
              <div className="payment-modal-table-scroll" ref={tableScrollRef}>
                <table className="payment-modal-table" dir="rtl">
                  <thead>
                    <tr>
                      <th className="pm-mono payment-modal-th-code">קוד תשלום</th>
                      <th className="pm-mono payment-modal-th-code">הזמנה</th>
                      <th>תאריך</th>
                      <th>שבוע</th>
                      <th className="pm-num">שער</th>
                      <th className="pm-num pm-th-amt">$ סכום</th>
                      <th className="pm-num">עמלה</th>
                      <th className="pm-num pm-th-total">יתרה ($)</th>
                      <th>סטטוס</th>
                      <th className="payment-modal-th-check" aria-label="עדיפות לסגירה" />
                      <th className="payment-modal-th-check" aria-label="סגור בתשלום" />
                    </tr>
                  </thead>
                  <tbody>
                    {matched.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="payment-modal-empty">
                          {customer ? "אין הזמנות" : "בחרו לקוח"}
                        </td>
                      </tr>
                    ) : (
                      matched.map((row) => (
                        <tr
                          key={row.id}
                          className={[
                            row.allocationUsd > 0.01 ? "payment-modal-tr--hit" : "",
                            row.allocationOutcome === "paid" ? "payment-modal-tr--alloc-paid" : "",
                            row.allocationOutcome === "partial" ? "payment-modal-tr--alloc-partial" : "",
                            rowStatusClass(row.status),
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <td dir="ltr" className="pm-mono payment-modal-td-code">
                            {row.paymentCode ?? "—"}
                          </td>
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
                          <td
                            dir="ltr"
                            className="pm-num pm-num--usd"
                            title={
                              commissionPercentN > 0
                                ? `סכום מקורי: ${fmtUsdDisplay(row.amountUsd)} · אחוז עמלה: ${commissionPercentN}%`
                                : undefined
                            }
                          >
                            {fmtUsdDisplay(
                              roundMoney2(applyCommissionPercentDisplay(row.amountUsd, commissionPercentN)),
                            )}
                          </td>
                          <td dir="ltr" className="pm-num">
                            {fmtUsdDisplay(row.commissionUsd)}
                          </td>
                          <td dir="ltr" className="pm-num pm-num--total-usd">
                            <span
                              title={`מקורי: ${fmtUsdDisplay(row.totalAmountUsd)}\nשולם: ${fmtUsdDisplay(
                                roundMoney2(Math.max(0, row.paidAmount)),
                              )}`}
                            >
                              {fmtUsdDisplay(roundMoney2(Math.max(0, row.remainingAmount)))}
                            </span>
                          </td>
                          <td className="payment-modal-td-status">
                            <span className={`pm-status badge ${statusClass(row.status)}`}>
                              {row.status === "paid" ? "שולם" : row.status === "partial" ? "חלקי" : "לא שולם"}
                            </span>
                          </td>
                          <td className="payment-modal-td-check" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={rowChecked(row.id)}
                              onChange={() => toggleRow(row.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="עדיפות לסגירה"
                            />
                          </td>
                          <td className="payment-modal-td-check" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="pm-close-debt-btn"
                              disabled={row.remainingAmount <= 0.01}
                              onClick={() => addLineFromOrder(row)}
                            >
                              סגור בתשלום
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/**
               * אזור totals — Cards צבעוניים בסגנון POS / ERP פיננסי.
               * "סכום לא שולם" מציג LIVE PREVIEW: היתרה האמיתית פחות הסכום
               * שהמשתמש כרגע מקליד (לפני שמירה). זה preview בלבד —
               * הנתונים האמיתיים ב־DB נשארים ללא שינוי עד לחיצה על "שמור".
               */}
              <div className="payment-modal-orders-summary payment-modal-orders-summary--v2" role="region" aria-label="סיכום עסקאות לקוח" dir="rtl">
                <div className="payment-modal-orders-summary-card payment-modal-orders-summary-card--txn">
                  <div className="payment-modal-orders-summary-lbl">סך הכל עסקאות</div>
                  <div className="payment-modal-orders-summary-val" dir="ltr">
                    {fmtFooterAmount(ordersTableFooterTotals.totalTransactions)}
                  </div>
                  <div className="payment-modal-orders-summary-ex-vat" dir="ltr">
                    ללא מע״מ: {fmtFooterAmount(roundMoney2(ordersTableFooterTotals.totalTransactions / (1 + DEFAULT_VAT_RATE)))}
                  </div>
                </div>
                <div className="payment-modal-orders-summary-card payment-modal-orders-summary-card--paid">
                  <div className="payment-modal-orders-summary-lbl">סכום שולם</div>
                  <div className="payment-modal-orders-summary-val" dir="ltr">
                    {fmtFooterAmount(ordersTableFooterTotals.totalPaidDb)}
                  </div>
                </div>
                <div className="payment-modal-orders-summary-card payment-modal-orders-summary-card--rem">
                  <div className="payment-modal-orders-summary-lbl payment-modal-orders-summary-lbl--with-action">
                    <span className="payment-modal-orders-summary-lbl-text">
                      סכום לא שולם
                      {totals.totalUsd > 0 ? <span className="payment-modal-preview-tag">תצוגה מקדימה</span> : null}
                    </span>
                    {viewerIsAdmin && customer && resetBalanceMetrics.remainingToReset > 0.01 ? (
                      <button
                        type="button"
                        className={[
                          "pm-reset-balance-btn",
                          canResetCustomerBalance ? "pm-reset-balance-btn--ready" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        disabled={resetCustomerBusy}
                        onClick={() => setResetCustomerConfirmOpen(true)}
                        title={
                          canResetCustomerBalance
                            ? totals.totalUsd > 0.01
                              ? "איפוס יתרה — לאחר שמירת התשלום ייסגר היתרה הנותרת מהעמלות"
                              : "איפוס יתרה — סוגר את כל היתרות הפתוחות של הלקוח ומוריד את ההפרש מהעמלות (מהחדש לישן)"
                            : "אין מספיק עמלה זמינה לאיפוס — ניתן לנסות לאחר שמירת תשלום"
                        }
                      >
                        <svg
                          className="pm-reset-balance-icon"
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <polyline points="1 4 1 10 7 10" />
                          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                        {resetCustomerBusy ? "מאפס…" : "איפוס יתרה"}
                      </button>
                    ) : null}
                  </div>
                  <div className="payment-modal-orders-summary-val" dir="ltr">
                    {fmtFooterAmount(roundMoney2(Math.max(0, ordersTableFooterTotals.remaining - totals.totalUsd)))}
                  </div>
                  {totals.totalUsd > 0 ? (
                    <div className="payment-modal-preview-delta" dir="ltr">
                      − {fmtFooterAmount(roundMoney2(totals.totalUsd))} (תשלום נוכחי)
                    </div>
                  ) : null}
                </div>
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
                        navSpinDirection === "prev" ? "payment-nav-arrow--busy" : "",
                        paymentNavAvailable.prev === false ? "payment-nav-arrow--edge" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label="קליטת תשלום קודמת"
                      disabled={prevPaymentNavDisabled}
                      onClick={goToPreviousPayment}
                    >
                      {navSpinDirection === "prev" ? <span className="payment-modal-save-spinner" aria-hidden /> : "◀"}
                    </button>
                    {loadedPayment?.paymentCode?.trim() ? (
                      <div className="payment-nav-code" dir="ltr" aria-label="קוד קליטת תשלום">
                        {paymentCaptureNavLabel}
                      </div>
                    ) : (
                      <div className="payment-nav-code payment-modal-code-pending" dir="ltr" aria-busy="true">
                        <span className="payment-modal-save-spinner" aria-hidden />
                      </div>
                    )}
                    <button
                      type="button"
                      className={[
                        "payment-nav-arrow",
                        navSpinDirection === "next" ? "payment-nav-arrow--busy" : "",
                        paymentNavAvailable.next === false ? "payment-nav-arrow--edge" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label="קליטת תשלום הבאה"
                      disabled={nextPaymentNavDisabled}
                      onClick={goToNextPayment}
                    >
                      {navSpinDirection === "next" ? <span className="payment-modal-save-spinner" aria-hidden /> : "▶"}
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
                    disabled={saveBusy || !customer}
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
                    <strong>{totals.totalPaymentsCount}</strong>
                  </div>
                </div>

                <div className="payment-upd-lines" aria-label="תשלומים שנוספו">
                  {payments.map((p, idx) => {
                    const calc = calculatePaymentLine(p, rateN, DEFAULT_VAT_RATE);
                    const amtStr = p.amount === "" ? "" : String(p.amount);
                    const cur: PaymentLineCurrency = p.currency;
                    const currSym = cur === "USD" ? "$" : "₪";
                    /**
                     * "תשלום N" — מספר הסידור משקף את סדר ההוספה
                     * (התשלום החדש מוצג ראשון אך מסומן בערך הגבוה ביותר).
                     * idx=0 (החדש ביותר) = payments.length, ידוע ככזה.
                     */
                    const ordinal = payments.length - idx;
                    const isLatest = idx === 0;
                    return (
                      <div
                        key={p.id}
                        className={`payment-upd-linecard${isLatest ? " payment-upd-linecard--latest" : ""}`}
                      >
                        <div className="payment-upd-linecard-head">
                          <div className="payment-upd-linecard-title">
                            תשלום {ordinal}
                            {isLatest ? <span className="payment-upd-linecard-tag">חדש</span> : null}
                          </div>
                          <button type="button" className="payment-upd-del" aria-label="מחיקת תשלום" onClick={() => removePaymentLine(p.id)}>
                            ✕
                          </button>
                        </div>

                        <div className="payment-upd-grid">
                          <label className="payment-modal-lbl payment-upd-lbl">
                            סכום
                            <input
                              ref={idx === 0 ? firstAmountInputRef : undefined}
                              inputMode="decimal"
                              dir="ltr"
                              className="payment-modal-inp payment-modal-inp--num payment-modal-inp--amount"
                              value={amtStr}
                              onChange={(e) => {
                                const raw = sanitizeMoneyInput(e.target.value);
                                if (!raw) updatePaymentLine(p.id, { amount: "" });
                                else updatePaymentLine(p.id, { amount: Number(raw) });
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                                e.preventDefault();
                                if (idx !== 0) return;
                                if (saveBusy) return;
                                if (!customer) {
                                  customerCodeInputRef.current?.focus();
                                  return;
                                }
                                window.setTimeout(() => saveAndNewButtonRef.current?.focus(), 0);
                              }}
                            />
                          </label>
                          <label className="payment-modal-lbl payment-upd-lbl">
                            מטבע
                            <select
                              className="payment-modal-inp"
                              value={p.currency}
                              onChange={(e) => updatePaymentLine(p.id, { currency: e.target.value as PaymentLineCurrency })}
                            >
                              <option value="ILS">₪ שקלים</option>
                              <option value="USD">$ דולרים</option>
                            </select>
                          </label>
                          <label className="payment-modal-lbl payment-upd-lbl">
                            מע״מ
                            <select
                              className="payment-modal-inp"
                              value={p.vatMode}
                              onChange={(e) => updatePaymentLine(p.id, { vatMode: e.target.value as PaymentLineVatMode })}
                            >
                              <option value="INCLUDING_VAT">{vatModeLabel("INCLUDING_VAT")}</option>
                              <option value="BEFORE_VAT">{vatModeLabel("BEFORE_VAT")}</option>
                              <option value="EXEMPT">{vatModeLabel("EXEMPT")}</option>
                            </select>
                          </label>
                          <label className="payment-modal-lbl payment-upd-lbl">
                            צורת תשלום
                            <select
                              className="payment-modal-inp"
                              value={p.paymentMethod}
                              onChange={(e) => {
                                const nextMethod = e.target.value as PaymentLineMethod;
                                const patch: Partial<PaymentLine> = {
                                  paymentMethod: nextMethod,
                                };
                                if (nextMethod === "CHECK") {
                                  patch.checks =
                                    p.checks && p.checks.length > 0 ? p.checks : [emptyCheckRow()];
                                } else {
                                  patch.checks = undefined;
                                }
                                updatePaymentLine(p.id, patch);
                              }}
                            >
                              <option value="CREDIT">{paymentMethodLabel("CREDIT")}</option>
                              <option value="BANK_TRANSFER">{paymentMethodLabel("BANK_TRANSFER")}</option>
                              <option value="CASH">{paymentMethodLabel("CASH")}</option>
                              <option value="CHECK">{paymentMethodLabel("CHECK")}</option>
                              <option value="OTHER">{paymentMethodLabel("OTHER")}</option>
                            </select>
                          </label>
                          {p.paymentMethod === "CHECK" ? (
                            <div className="payment-upd-checks" dir="rtl">
                              <div className="payment-upd-checks-header">
                                <span className="payment-upd-checks-header-icon" aria-hidden>
                                  💳
                                </span>
                                <span className="payment-upd-checks-header-title">פרטי צ׳יקים</span>
                              </div>
                              {(p.checks?.length ?? 0) === 0 ? (
                                <button
                                  type="button"
                                  className="payment-upd-check-add-row"
                                  onClick={() => updatePaymentLine(p.id, { checks: [emptyCheckRow()] })}
                                >
                                  + הוסף צ׳יק נוסף
                                </button>
                              ) : (
                                <>
                                  <div className="payment-upd-check-cards">
                                    {p.checks!.map((ch, chi) => (
                                      <div className="payment-upd-check-card" key={ch.id}>
                                        <div className="payment-upd-check-card-head">
                                          <span className="payment-upd-check-card-title">צ׳יק #{chi + 1}</span>
                                          {p.checks!.length > 1 ? (
                                            <button
                                              type="button"
                                              className="payment-upd-check-card-remove"
                                              aria-label="הסר צ׳יק"
                                              onClick={() => removePaymentLineCheck(p.id, ch.id)}
                                            >
                                              ✕
                                            </button>
                                          ) : null}
                                        </div>
                                        <div className="payment-upd-check-card-body">
                                          <label className="payment-upd-check-field">
                                            <span className="payment-upd-check-field-lbl">מס׳ צ׳יק</span>
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              dir="ltr"
                                              className={[
                                                "payment-upd-check-inp",
                                                highlightInvalidCheckFields && checkFieldMissingNumber(ch)
                                                  ? "payment-upd-check-inp--err"
                                                  : "",
                                              ]
                                                .filter(Boolean)
                                                .join(" ")}
                                              value={ch.checkNumber}
                                              onChange={(e) =>
                                                updatePaymentLineCheck(p.id, ch.id, {
                                                  checkNumber: sanitizeCheckNumberInput(e.target.value),
                                                })
                                              }
                                              autoComplete="off"
                                            />
                                          </label>
                                          <label className="payment-upd-check-field">
                                            <span className="payment-upd-check-field-lbl">תאריך פרעון</span>
                                            <input
                                              type="date"
                                              dir="ltr"
                                              className={[
                                                "payment-upd-check-inp payment-upd-check-inp--date",
                                                highlightInvalidCheckFields && checkFieldMissingDue(ch)
                                                  ? "payment-upd-check-inp--err"
                                                  : "",
                                              ]
                                                .filter(Boolean)
                                                .join(" ")}
                                              value={ch.dueDateYmd}
                                              onChange={(e) =>
                                                updatePaymentLineCheck(p.id, ch.id, { dueDateYmd: e.target.value })
                                              }
                                            />
                                          </label>
                                          <label className="payment-upd-check-field">
                                            <span className="payment-upd-check-field-lbl">סכום צ׳יק</span>
                                            <input
                                              type="text"
                                              inputMode="decimal"
                                              dir="ltr"
                                              className={[
                                                "payment-upd-check-inp",
                                                highlightInvalidCheckFields && checkFieldMissingAmount(ch)
                                                  ? "payment-upd-check-inp--err"
                                                  : "",
                                              ]
                                                .filter(Boolean)
                                                .join(" ")}
                                              value={ch.amount === "" ? "" : String(ch.amount)}
                                              onChange={(e) => {
                                                const raw = sanitizeMoneyInput(e.target.value);
                                                if (!raw) updatePaymentLineCheck(p.id, ch.id, { amount: "" });
                                                else updatePaymentLineCheck(p.id, ch.id, { amount: Number(raw) });
                                              }}
                                            />
                                          </label>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    className="payment-upd-check-add-row"
                                    onClick={() => addPaymentLineCheck(p.id)}
                                  >
                                    + הוסף צ׳יק נוסף
                                  </button>
                                  <div className="payment-upd-checks-summary" dir="rtl">
                                    <span className="payment-upd-checks-summary-lbl">סה״כ צ׳יקים</span>
                                    <span className="payment-upd-checks-summary-val" dir="ltr">
                                      {currSym} {fmtFooterAmount(
                                        roundMoney2(
                                          p.checks!.reduce((acc, c) => {
                                            const n =
                                              typeof c.amount === "number" && Number.isFinite(c.amount)
                                                ? c.amount
                                                : 0;
                                            return acc + n;
                                          }, 0),
                                        ),
                                      )}
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : null}
                          <label className="payment-modal-lbl payment-upd-lbl payment-upd-lbl--full">
                            הערה
                            <input
                              type="text"
                              className="payment-modal-inp"
                              value={p.note ?? ""}
                              onChange={(e) => updatePaymentLine(p.id, { note: e.target.value })}
                              placeholder="הערה קצרה…"
                            />
                          </label>
                        </div>

                        <div className="payment-upd-calc" dir="rtl" aria-live="polite">
                          <div className="payment-upd-calc-row">
                            <span>הזן</span>
                            <span dir="ltr">
                              {currSym} {fmtFooterAmount(typeof p.amount === "number" ? p.amount : 0)}
                            </span>
                          </div>
                          <div className="payment-upd-calc-row">
                            <span>בסיס לפני מע״מ</span>
                            <span dir="ltr">
                              {currSym} {fmtFooterAmount(calc.baseAmount)}
                            </span>
                          </div>
                          <div className="payment-upd-calc-row">
                            <span>{formatVatPercentLabel()}</span>
                            <span dir="ltr">
                              {currSym} {fmtFooterAmount(calc.vatAmount)}
                            </span>
                          </div>
                          <div
                            className="payment-upd-calc-row payment-upd-calc-row--net"
                            title="סכום לתשלום אחרי מע״מ (במטבע השורה)"
                          >
                            <span>סכום סופי לתשלום</span>
                            <span dir="ltr">
                              {currSym} {fmtFooterAmount(calc.finalAmount)}
                            </span>
                          </div>
                          <div className="payment-upd-calc-row payment-upd-calc-row--usd">
                            <span>סכום סופי בדולר</span>
                            <span dir="ltr">{fmtUsdDisplay(calc.finalUsd)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>

            <div className="payment-modal-side-sticky payment-summary-stack payment-summary-stack--v2">
              <div className="payment-upd-sticky-total payment-upd-sticky-total--basis-led" aria-live="polite">
                <div className="payment-upd-sticky-total-amounts">
                  <span className="payment-upd-sticky-total-usd" dir="ltr">
                    {fmtUsdDisplay(stickyBaseTotals.usd)}
                  </span>
                  <div className="payment-upd-sticky-total-lbl">סה״כ לתשלום</div>
                  <span className="payment-upd-sticky-total-ils" dir="ltr">
                    {fmtIlsDisplay(stickyBaseTotals.ils)}
                  </span>
                </div>
              </div>
              {saveErr ? <div className="payment-modal-err payment-modal-err--sm">{saveErr}</div> : null}
              <Button
                type="button"
                variant="primary"
                className={`btn-save payment-modal-save payment-modal-save--v2${saveBusy ? " loading" : ""}`}
                disabled={saveBusy || !customer}
                onClick={() => void onSaveAndClose()}
              >
                {saveBusy ? (
                  <>
                    <span className="payment-modal-save-spinner" aria-hidden />
                    שומר…
                  </>
                ) : (
                  "שמור תשלום"
                )}
              </Button>
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
      {resetCustomerConfirmOpen ? (
        <div
          className="adm-oc-edit-request-backdrop"
          role="presentation"
          onClick={() => {
            if (resetCustomerBusy) return;
            setResetCustomerConfirmOpen(false);
          }}
        >
          <div
            className="payment-nav-confirm-modal payment-reset-confirm-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h4>האם לאפס יתרה זו?</h4>
            <p>
              יתרה לאיפוס{" "}
              <strong dir="ltr">{fmtUsdDisplay(resetBalanceMetrics.remainingToReset)}</strong>
              {totals.totalUsd > 0.01 ? (
                <>
                  <br />
                  <span className="adm-muted-keys">
                    יש תשלום בטופס — האיפוס יבוצע לאחר שמירת התשלום (יתרה לאחר הקליטה).
                  </span>
                </>
              ) : null}
              <br />
              עמלה זמינה: <strong dir="ltr">{fmtUsdDisplay(resetBalanceMetrics.availableCommission)}</strong>
              <br />
              הפעולה תוריד את ההפרש מהעמלות (מהחדש לישן) ותסגור את כל ההזמנות הפתוחות של הלקוח.
            </p>
            <div className="payment-nav-confirm-actions">
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--dense"
                disabled={resetCustomerBusy}
                onClick={() => setResetCustomerConfirmOpen(false)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--dense"
                disabled={resetCustomerBusy}
                onClick={async () => {
                  setResetCustomerConfirmOpen(false);
                  if (totals.totalUsd > 0.01) {
                    resetAfterSaveRef.current = true;
                    onToast("לאחר שמירת התשלום תבוצע איפוס יתרה");
                    return;
                  }
                  await applyResetCustomerBalances();
                }}
              >
                אשר איפוס
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
            if (isNavigating) return;
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
                disabled={isNavigating}
                onClick={() => setNavUnsavedOpen(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--dense"
                disabled={isNavigating}
                onClick={() => confirmNavUnsavedAndProceed()}
              >
                כן
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

