"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PaymentMethod } from "@prisma/client";
import {
  buildAllocationsFromMatch,
  matchPaymentToOrders,
  toPaymentIntakeBases,
  type PaymentIntakeMatchResult,
  type PaymentIntakeOrderRow,
} from "@/lib/payment-intake";
import { fetchPaymentIntakeCustomerOrdersAction, type PaymentIntakeCustomerPayload } from "@/app/admin/payments/intake/actions";
import { fetchOrderForPaymentContextAction, previewPaymentCodeForCaptureAction, type CustomerSearchRow } from "@/app/admin/capture/actions";
import type { SerializedFinancial } from "@/lib/financial-settings";
import type { PaymentWindowProps } from "@/lib/admin-windows";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
import { useAdminGlobal } from "@/components/admin/AdminGlobalContext";
import { OrderEditModal } from "@/components/admin/OrderEditModal";
import Card from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { normalizeOrderSourceCountry, type OrderCountryCode } from "@/lib/order-countries";
import {
  DEFAULT_WEEK_CODE,
  WORK_WEEK_CODES_SORTED,
  WORK_WEEK_RANGES,
  formatLocalHm,
  formatLocalYmd,
  getWeekCodeForLocalDate,
  nextWeekCode,
  parseLocalDate,
  prevWeekCode,
} from "@/lib/work-week";
import {
  calculatePaymentLine,
  calculateTotals,
  DEFAULT_VAT_RATE,
  roundMoney2,
  type PaymentLine,
  type PaymentLineCurrency,
  type PaymentLineMethod,
  type PaymentLineVatMode,
} from "@/lib/payment-updated";
import { savePaymentUpdatedAction } from "@/app/admin/payments-updated/actions";
import { primaryCustomerDisplayName } from "@/lib/customer-names";

const COUNTRY_BADGE_SHORT: Record<OrderCountryCode, string> = {
  TURKEY: "טורקיה",
  CHINA: "סין",
  UAE: "אמירויות",
};

type BadgeEditField = "week" | "country" | "date" | "time" | null;

type CustFieldKey = "code" | "displayName" | "nameEn" | "nameAr" | "index";

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

function createDefaultLine(): PaymentLine {
  return {
    id: newLineId(),
    amount: "",
    currency: "USD",
    vatMode: "EXEMPT",
    paymentMethod: "BANK_TRANSFER",
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
  if (v === "BEFORE_VAT") return "ללא מע״מ";
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
};

export function PaymentModalUpdated({
  financial,
  onToast,
  initialPayment,
  resetOnKey,
  canViewCustomerCard = true,
  canEditOrders = true,
  canCreateOrders = true,
}: Props) {
  const { globalWeek } = useAdminGlobal();
  const defaultRate = useMemo(() => parseFinalRate(financial), [financial]);
  const { openWindow } = useAdminWindows();

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
  const [orderEditId, setOrderEditId] = useState<string | null>(null);

  const [paymentCodeDisp, setPaymentCodeDisp] = useState("—");
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

  const [payments, setPayments] = useState<PaymentLine[]>(() => [createDefaultLine()]);

  const [includedIds, setIncludedIds] = useState<string[] | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const customerIdRef = useRef<string | null>(null);
  customerIdRef.current = customer?.id ?? null;

  const initialAppliedRef = useRef(false);

  const rateN = parseNum(dollarRate);

  const totals = useMemo(() => calculateTotals(payments, rateN, DEFAULT_VAT_RATE), [payments, rateN]);

  const bases = useMemo(() => toPaymentIntakeBases(orders), [orders]);

  const eligibleSet = useMemo(() => {
    if (includedIds === null) return null;
    return new Set(includedIds);
  }, [includedIds]);

  const matched = useMemo(() => {
    return matchPaymentToOrders(bases, totals.totalUsd, eligibleSet);
  }, [bases, totals.totalUsd, eligibleSet]);

  const weekReadonly = useMemo(() => weekCodeFromYmd(paymentDateYmd), [paymentDateYmd]);

  const weekSelectValue = useMemo(() => {
    const w = weekReadonly !== "—" ? weekReadonly : DEFAULT_WEEK_CODE;
    return WORK_WEEK_RANGES[w] ? w : DEFAULT_WEEK_CODE;
  }, [weekReadonly]);

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

  useEffect(() => {
    void previewPaymentCodeForCaptureAction().then((r) => {
      if (r.ok) setPaymentCodeDisp(r.code);
    });
  }, []);

  const loadCustomerOrders = useCallback(async (customerId: string) => {
    setLoadingCustomer(true);
    setLoadErr(null);
    const res = await fetchPaymentIntakeCustomerOrdersAction(customerId);
    setLoadingCustomer(false);
    if (!res.ok) {
      setCustomer(null);
      setOrders([]);
      setLoadErr(res.error);
      return;
    }
    setCustomer(res.customer);
    setOrders(res.orders);
    setDraftCustomer({
      code: res.customer.customerCode ?? "",
      displayName: res.customer.displayName ?? "",
      nameEn: res.customer.nameEn ?? res.customer.nameHe ?? "",
      nameAr: res.customer.nameAr ?? "",
      index: res.customer.customerIndex ?? "",
    });
    setIncludedIds(null);
    setSaveErr(null);
    setCustSearchNoHits(false);
  }, []);

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
    setSearchTick((n) => n + 1);
    setCustDdOpen(true);
  }, []);

  const triggerFieldSearch = useCallback((field: CustFieldKey) => {
    lastEditedFieldRef.current = field;
    setSearchTick((n) => n + 1);
    setCustDdOpen(true);
  }, []);

  function navPaymentWeek(dir: "prev" | "next") {
    let code = weekCodeFromYmd(paymentDateYmd);
    if (code === "—") code = DEFAULT_WEEK_CODE;
    const target = dir === "prev" ? prevWeekCode(code) : nextWeekCode(code);
    if (!target || !WORK_WEEK_RANGES[target]) return;
    setPaymentDateYmd(WORK_WEEK_RANGES[target].from);
  }

  useEffect(() => {
    if (!initialPayment || initialAppliedRef.current) return;
    initialAppliedRef.current = true;
    void (async () => {
      const onum = initialPayment.orderNumber?.trim();
      const cid = initialPayment.customerId?.trim();
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
      } else if (initialPayment.customerName?.trim()) {
        lastEditedFieldRef.current = "displayName";
        setDraftCustomer((p) => ({ ...p, displayName: initialPayment.customerName!.trim() }));
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
    setPaymentDateYmd(formatLocalYmd(new Date()));
    setPaymentTimeHm(formatLocalHm(new Date()));
    void previewPaymentCodeForCaptureAction().then((r) => {
      if (r.ok) setPaymentCodeDisp(r.code);
    });
    setSaveErr(null);
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

  const allOrderIds = useMemo(() => orders.map((o) => o.id), [orders]);

  function toggleRow(id: string) {
    setIncludedIds((prev) => {
      const base = prev ?? [...allOrderIds];
      const set = new Set(base);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      const arr = [...set];
      if (arr.length === allOrderIds.length && allOrderIds.length > 0) return null;
      return arr;
    });
  }

  function rowChecked(id: string): boolean {
    if (includedIds === null) return true;
    return includedIds.includes(id);
  }

  function addPaymentLine(preset?: Partial<PaymentLine>) {
    setPayments((cur) => [...cur, { ...createDefaultLine(), ...preset, id: newLineId() }]);
  }

  function removePaymentLine(id: string) {
    setPayments((cur) => cur.filter((x) => x.id !== id));
  }

  function updatePaymentLine(id: string, patch: Partial<PaymentLine>) {
    setPayments((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function addLineFromOrder(row: PaymentIntakeMatchResult) {
    const remUsd = roundMoney2(Math.max(0, row.remainingAmount));
    if (remUsd <= 0.01) return;
    const onum = row.orderNumber ?? row.id.slice(0, 8);
    addPaymentLine({
      amount: remUsd,
      currency: "USD",
      vatMode: "EXEMPT",
      paymentMethod: "BANK_TRANSFER",
      note: `סגירת חיוב הזמנה ${onum}`,
    });
    onToast("נוסף תשלום מסגירת חיוב (ללא שמירה)");
  }

  async function onSave() {
    setSaveErr(null);
    if (!customer) {
      setSaveErr("יש לבחור לקוח");
      return;
    }
    if (totals.totalUsd <= 0) {
      setSaveErr("יש להוסיף תשלום");
      return;
    }
    if (rateN <= 0) {
      setSaveErr("שער דולר חייב להיות חיובי");
      return;
    }

    const allocations = buildAllocationsFromMatch(bases, totals.totalUsd, eligibleSet);
    if (allocations.length === 0) {
      setSaveErr("אין יעד להקצאה");
      return;
    }

    setSaveBusy(true);
    const receivedTodaySave = isTodayYmd(paymentDateYmd);
    const hm = (paymentTimeHm || "").trim() || formatLocalHm(new Date());
    const weekForSave = weekReadonly !== "—" ? weekReadonly : null;
    const res = await savePaymentUpdatedAction({
      customerId: customer.id,
      receivedToday: receivedTodaySave,
      paymentDateYmd: receivedTodaySave ? formatLocalYmd(new Date()) : paymentDateYmd,
      paymentTimeHm: hm,
      weekCode: weekForSave,
      dollarRate,
      payments,
      includedOrderIds: includedIds,
    });
    setSaveBusy(false);
    if (!res.ok) {
      setSaveErr(res.error);
      return;
    }
    onToast("התשלום נשמר בהצלחה");
    setPayments([createDefaultLine()]);
    setPaymentTimeHm(formatLocalHm(new Date()));
    void previewPaymentCodeForCaptureAction().then((r) => {
      if (r.ok) setPaymentCodeDisp(r.code);
    });
    const reload = await fetchPaymentIntakeCustomerOrdersAction(customer.id);
    if (reload.ok) {
      setOrders(reload.orders);
      setIncludedIds(null);
    }
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
            <div className="payment-modal-topnav" dir="ltr" aria-label="ניווט שבוע עבודה">
              <button type="button" className="payment-modal-nav-arrow" onClick={() => navPaymentWeek("prev")} aria-label="שבוע קודם">
                ‹
              </button>
              <button type="button" className="payment-modal-nav-arrow" onClick={() => navPaymentWeek("next")} aria-label="שבוע הבא">
                ›
              </button>
            </div>
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
                    <input
                      type="text"
                      autoComplete="off"
                      className="payment-modal-cust-inp"
                      dir="ltr"
                      value={draftCustomer.code}
                      onChange={(e) => onDraftCustomerChange("code", e.target.value)}
                    />
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
                      className="payment-modal-cust-inp"
                      value={draftCustomer.displayName}
                      onChange={(e) => onDraftCustomerChange("displayName", e.target.value)}
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
              <div className="payment-modal-table-scroll">
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
                      <th className="pm-num pm-th-total">סה״כ ($)</th>
                      <th>סטטוס</th>
                      <th className="payment-modal-th-check" aria-label="כלול בחישוב" />
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
                          <td dir="ltr" className="pm-num pm-num--usd">
                            {fmtUsdDisplay(row.amountUsd)}
                          </td>
                          <td dir="ltr" className="pm-num">
                            {fmtUsdDisplay(row.commissionUsd)}
                          </td>
                          <td dir="ltr" className="pm-num pm-num--total-usd">
                            {fmtUsdDisplay(row.totalAmountUsd)}
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
                              aria-label="הזמנה בחישוב"
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

              <div className="payment-modal-orders-summary" role="region" aria-label="סיכום עסקאות לקוח" dir="rtl">
                <div className="payment-modal-orders-summary-card payment-modal-orders-summary-card--txn">
                  <div className="payment-modal-orders-summary-val" dir="ltr">
                    {fmtFooterAmount(ordersTableFooterTotals.totalTransactions)}
                  </div>
                  <div className="payment-modal-orders-summary-lbl">סך הכל עסקאות</div>
                </div>
                <div className="payment-modal-orders-summary-card payment-modal-orders-summary-card--paid">
                  <div className="payment-modal-orders-summary-val" dir="ltr">
                    {fmtFooterAmount(ordersTableFooterTotals.totalPaidDb)}
                  </div>
                  <div className="payment-modal-orders-summary-lbl">סכום ששולם</div>
                </div>
                <div className="payment-modal-orders-summary-card payment-modal-orders-summary-card--rem">
                  <div className="payment-modal-orders-summary-val" dir="ltr">
                    {fmtFooterAmount(ordersTableFooterTotals.remaining)}
                  </div>
                  <div className="payment-modal-orders-summary-lbl">סכום לא שולם</div>
                </div>
              </div>
            </div>
          </div>

          <aside className="payment-modal-side payment-modal-side--compact payment-summary" dir="rtl">
            <div className="payment-modal-side-body">
              <div className="payment-modal-side-inner payment-modal-side-inner--payment-only">
                <label className="payment-modal-lbl payment-modal-lbl--micro">
                  קוד תשלום
                  <input type="text" readOnly className="payment-modal-inp payment-modal-inp--ro" dir="ltr" value={paymentCodeDisp} />
                </label>

                <div className="payment-upd-addrow">
                  <button type="button" className="payment-upd-add-btn" onClick={() => addPaymentLine()} disabled={saveBusy}>
                    + הוסף תשלום
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
                    return (
                      <div key={p.id} className="payment-upd-linecard">
                        <div className="payment-upd-linecard-head">
                          <div className="payment-upd-linecard-title">
                            תשלום {idx + 1}
                          </div>
                          <button type="button" className="payment-upd-del" aria-label="מחיקת תשלום" onClick={() => removePaymentLine(p.id)}>
                            ✕
                          </button>
                        </div>

                        <div className="payment-upd-grid">
                          <label className="payment-modal-lbl payment-upd-lbl">
                            סכום
                            <input
                              inputMode="decimal"
                              dir="ltr"
                              className="payment-modal-inp payment-modal-inp--num"
                              value={amtStr}
                              onChange={(e) => {
                                const raw = sanitizeMoneyInput(e.target.value);
                                if (!raw) updatePaymentLine(p.id, { amount: "" });
                                else updatePaymentLine(p.id, { amount: Number(raw) });
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
                              <option value="EXEMPT">{vatModeLabel("EXEMPT")}</option>
                              <option value="BEFORE_VAT">{vatModeLabel("BEFORE_VAT")}</option>
                              <option value="INCLUDING_VAT">{vatModeLabel("INCLUDING_VAT")}</option>
                            </select>
                          </label>
                          <label className="payment-modal-lbl payment-upd-lbl">
                            צורת תשלום
                            <select
                              className="payment-modal-inp"
                              value={p.paymentMethod}
                              onChange={(e) => updatePaymentLine(p.id, { paymentMethod: e.target.value as PaymentLineMethod })}
                            >
                              <option value="CREDIT">{paymentMethodLabel("CREDIT")}</option>
                              <option value="BANK_TRANSFER">{paymentMethodLabel("BANK_TRANSFER")}</option>
                              <option value="CASH">{paymentMethodLabel("CASH")}</option>
                              <option value="CHECK">{paymentMethodLabel("CHECK")}</option>
                              <option value="OTHER">{paymentMethodLabel("OTHER")}</option>
                            </select>
                          </label>
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
                            <span>הוזן</span>
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
                            <span>מע״מ</span>
                            <span dir="ltr">
                              {currSym} {fmtFooterAmount(calc.vatAmount)}
                            </span>
                          </div>
                          <div className="payment-upd-calc-row payment-upd-calc-row--final">
                            <span>סכום סופי</span>
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

                <div className="payment-upd-totals">
                  <Card className="payment-modal-total-ds">
                    <div className="payment-modal-total payment-modal-total--compact payment-modal-total--pay-only" aria-live="polite">
                      <div className="payment-modal-total-lbl">סה״כ לתשלום (USD)</div>
                      <div className="payment-modal-total-val" dir="ltr">
                        {fmtUsdDisplay(totals.totalUsd)}
                      </div>
                      <div className="payment-upd-total-ils" dir="ltr">
                        {fmtIlsDisplay(totals.totalIls)}
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </div>

            <div className="payment-modal-side-sticky payment-summary-stack">
              {saveErr ? <div className="payment-modal-err payment-modal-err--sm">{saveErr}</div> : null}
              <Button
                type="button"
                variant="primary"
                className={`btn-save payment-modal-save${saveBusy ? " loading" : ""}`}
                disabled={saveBusy || !customer}
                onClick={() => void onSave()}
              >
                {saveBusy ? "שומר…" : "שמור תשלום"}
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
    </>
  );
}

