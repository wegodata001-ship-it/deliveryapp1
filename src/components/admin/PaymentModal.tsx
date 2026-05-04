"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PaymentMethod } from "@prisma/client";
import {
  buildAllocationsFromMatch,
  computeIntakeTotalUsd,
  matchPaymentToOrders,
  roundMoney2,
  toPaymentIntakeBases,
  type PaymentIntakeMatchResult,
  type PaymentIntakeOrderRow,
} from "@/lib/payment-intake";
import {
  fetchPaymentIntakeCustomerOrdersAction,
  savePaymentIntakeAction,
  type PaymentIntakeCustomerPayload,
} from "@/app/admin/payments/intake/actions";
import {
  fetchOrderForPaymentContextAction,
  previewPaymentCodeForCaptureAction,
  type CustomerSearchRow,
} from "@/app/admin/capture/actions";
import type { SerializedFinancial } from "@/lib/financial-settings";
import type { PaymentWindowProps } from "@/lib/admin-windows";
import { useAdminWindows } from "@/components/admin/AdminWindowProvider";
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

/** סכום העברה בנקאית כולל מע״מ — פירוק נטו לפי 18% */
const BANK_TRANSFER_INCLUDES_VAT_FACTOR = 1.18;

const COUNTRY_BADGE_SHORT: Record<OrderCountryCode, string> = {
  TURKEY: "טורקיה",
  CHINA: "סין",
  UAE: "אמירויות",
};

type BadgeEditField = "week" | "country" | "date" | "time" | null;

type CustFieldKey = "code" | "displayName" | "nameHe" | "nameAr" | "index";

type CustomerApiSearchRow = {
  id: string;
  customerCode: string | null;
  oldCustomerCode: string | null;
  displayName: string;
  nameHe: string | null;
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
  nameHe: "",
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

/** סיכום תחתון — מספרים בלבד (אלפים + 2 עשרוניות), יישור LTR */
function fmtFooterAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** סה״כ שורה ב-USD: עדיפות לערך מהשרת; אם חסר — המרה מ-₪ לפי שער השורה */
function orderRowTotalUsd(row: PaymentIntakeMatchResult): number {
  const usd = row.totalAmountUsd;
  if (Number.isFinite(usd) && usd > 0) return roundMoney2(usd);
  const r = row.rate;
  const ils = row.totalIls;
  if (Number.isFinite(r) && r > 0 && Number.isFinite(ils) && ils > 0) return roundMoney2(ils / r);
  return roundMoney2(Number.isFinite(usd) ? usd : 0);
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

type Props = {
  financial: SerializedFinancial | null;
  /** שמור לתאימות מול חלון — לא בשימוש פנימי */
  onClose?: () => void;
  onToast: (msg: string) => void;
  initialPayment?: PaymentWindowProps;
  resetOnKey?: string | number;
  canViewCustomerCard?: boolean;
  /** ברירת מחדל true — מועבר מ־AdminWindowStack לפי הרשאות */
  canEditOrders?: boolean;
  canCreateOrders?: boolean;
};

export function PaymentModal({
  financial,
  onToast,
  initialPayment,
  resetOnKey,
  canViewCustomerCard = true,
  canEditOrders = true,
  canCreateOrders = true,
}: Props) {
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
  const [paymentDateYmd, setPaymentDateYmd] = useState(() => formatLocalYmd(new Date()));
  const [paymentTimeHm, setPaymentTimeHm] = useState(() => formatLocalHm(new Date()));

  const [usdPaid, setUsdPaid] = useState("");
  const [ilsPaid, setIlsPaid] = useState("");
  const [transferPaid, setTransferPaid] = useState("");
  const [dollarRate, setDollarRate] = useState(() => defaultRate.toFixed(4));
  /** אמצעי ברירת מחדל לשמירה — ללא בחירה בממשק */
  const [paymentMethod] = useState<PaymentMethod>(PaymentMethod.CREDIT);

  const [includedIds, setIncludedIds] = useState<string[] | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const customerIdRef = useRef<string | null>(null);
  customerIdRef.current = customer?.id ?? null;

  const initialAppliedRef = useRef(false);

  const rateN = parseNum(dollarRate);
  const uN = parseNum(usdPaid);
  const iN = parseNum(ilsPaid);
  const tN = parseNum(transferPaid);

  const totalUsdLive = useMemo(() => {
    return roundMoney2(
      computeIntakeTotalUsd({
        usdPaid: uN,
        ilsPaid: iN,
        transferPaid: tN,
        dollarRate: rateN,
      }),
    );
  }, [uN, iN, tN, rateN]);

  const bases = useMemo(() => toPaymentIntakeBases(orders), [orders]);

  const eligibleSet = useMemo(() => {
    if (includedIds === null) return null;
    return new Set(includedIds);
  }, [includedIds]);

  const matched = useMemo(() => {
    return matchPaymentToOrders(bases, totalUsdLive, eligibleSet);
  }, [bases, totalUsdLive, eligibleSet]);

  const weekReadonly = useMemo(() => weekCodeFromYmd(paymentDateYmd), [paymentDateYmd]);

  const weekSelectValue = useMemo(() => {
    const w = weekReadonly !== "—" ? weekReadonly : DEFAULT_WEEK_CODE;
    return WORK_WEEK_RANGES[w] ? w : DEFAULT_WEEK_CODE;
  }, [weekReadonly]);

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
      tx += orderRowTotalUsd(row);
      const p = row.dbPaidUsd;
      paidSum += Number.isFinite(p) ? p : 0;
    }
    const totalTransactions = roundMoney2(tx);
    const totalPaidDb = roundMoney2(paidSum);
    const remaining = roundMoney2(Math.max(0, totalTransactions - totalPaidDb));
    return { totalTransactions, totalPaidDb, remaining };
  }, [matched]);

  /** העברה ללא מע״מ (₪) — סכום ההעברה כולל מע״מ מפוצל ב־1.18 */
  const transferNoVatIls = useMemo(() => {
    if (!Number.isFinite(tN) || tN <= 0) return 0;
    return roundMoney2(tN / BANK_TRANSFER_INCLUDES_VAT_FACTOR);
  }, [tN]);

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
      nameHe: res.customer.nameHe ?? "",
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
          const emptyAmt =
            !initialPayment.amountUsd?.trim() && !initialPayment.amountIls?.trim();
          if (Number.isFinite(rem) && rem > 0.01 && emptyAmt) {
            setUsdPaid(String(rem).replace(/,/g, ""));
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
      if (initialPayment.amountIls?.trim()) setIlsPaid(initialPayment.amountIls.replace(/,/g, ""));
      if (initialPayment.amountUsd?.trim()) setUsdPaid(initialPayment.amountUsd.replace(/,/g, ""));
    })();
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
    setUsdPaid("");
    setIlsPaid("");
    setTransferPaid("");
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

        let rows: CustomerApiSearchRow[] = [];
        try {
          const res = await fetch(`/api/customers?query=${encodeURIComponent(q)}`);
          if (!res.ok) {
            if (!cancelled && gen === custSearchGenRef.current) {
              setCustomerHits([]);
              setCustSearchNoHits(false);
            }
            return;
          }
          const data = (await res.json()) as { customers?: CustomerApiSearchRow[] };
          rows = data.customers ?? [];
        } catch {
          if (!cancelled && gen === custSearchGenRef.current) {
            setCustomerHits([]);
            setCustSearchNoHits(false);
          }
          return;
        }

        if (cancelled || gen !== custSearchGenRef.current) return;

        const still = draftCustomerRef.current[lastEditedFieldRef.current].trim() === q;
        if (!still) return;

        const hits: CustomerSearchRow[] = rows.map((r) => ({
          id: r.id,
          label: r.displayName,
          code: r.customerCode,
          customerType: r.customerType,
          city: r.city,
          phone: r.phone,
        }));

        setCustSearchNoHits(rows.length === 0);

        const uuidQuick = rows.length === 1 && UUID_SEARCH_RE.test(q.trim()) && rows[0]!.id === q.trim();
        const codeOrIndexQuick =
          rows.length === 1 &&
          (field === "code" || field === "index") &&
          q.length >= 1 &&
          q.length < 2;
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

  async function onSave() {
    setSaveErr(null);
    if (!customer) {
      setSaveErr("יש לבחור לקוח");
      return;
    }
    if (totalUsdLive <= 0) {
      setSaveErr("יש להזין סכום");
      return;
    }
    const allocations = buildAllocationsFromMatch(bases, totalUsdLive, eligibleSet);
    if (allocations.length === 0) {
      setSaveErr("אין יעד להקצאה");
      return;
    }
    const receivedTodaySave = isTodayYmd(paymentDateYmd);
    const hm = (paymentTimeHm || "").trim() || formatLocalHm(new Date());
    const weekForSave = weekReadonly !== "—" ? weekReadonly : null;
    setSaveBusy(true);
    const res = await savePaymentIntakeAction({
      customerId: customer.id,
      receivedToday: receivedTodaySave,
      paymentDateYmd: receivedTodaySave ? formatLocalYmd(new Date()) : paymentDateYmd,
      paymentTimeHm: hm,
      paymentMethod,
      paymentPlace: null,
      weekCode: weekForSave,
      dollarRate,
      totalUsd: totalUsdLive.toFixed(2),
      usdPaid,
      ilsPaid,
      transferPaid,
      transferNoVat: transferNoVatIls.toFixed(2),
      notes: null,
      commissionNote: null,
      allocations,
    });
    setSaveBusy(false);
    if (!res.ok) {
      setSaveErr(res.error);
      return;
    }
    onToast("התשלום נשמר בהצלחה");
    setUsdPaid("");
    setIlsPaid("");
    setTransferPaid("");
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
                  <span className="payment-modal-cust-inp-lbl">שם בעברית</span>
                  <input
                    type="text"
                    autoComplete="off"
                    className="payment-modal-cust-inp"
                    value={draftCustomer.nameHe}
                    onChange={(e) => onDraftCustomerChange("nameHe", e.target.value)}
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

              {editingBadge === "week" ? (
                <select
                  className="payment-modal-inline-input"
                  dir="ltr"
                  autoFocus
                  value={weekSelectValue}
                  onChange={(e) => {
                    const code = e.target.value;
                    if (code && WORK_WEEK_RANGES[code]) setPaymentDateYmd(WORK_WEEK_RANGES[code].from);
                  }}
                  onBlur={() => setEditingBadge(null)}
                  onKeyDown={badgeKeyFinish}
                  aria-label="שבוע"
                >
                  {WORK_WEEK_CODES_SORTED.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                <button type="button" className="payment-modal-inline-static" onClick={() => setEditingBadge("week")} aria-label="שבוע — עריכה">
                  <span dir="ltr">{weekReadonly || "—"}</span>
                </button>
              )}
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
                  </tr>
                </thead>
                <tbody>
                  {matched.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="payment-modal-empty">
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
                          {fmtUsdDisplay(orderRowTotalUsd(row))}
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
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div
              className="payment-modal-orders-summary"
              role="region"
              aria-label="סיכום עסקאות לקוח"
              dir="rtl"
            >
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
          <div className="payment-modal-side-body payment-modal-side-body--fit">
            <div className="payment-modal-side-inner payment-modal-side-inner--payment-only">
              <label className="payment-modal-lbl payment-modal-lbl--micro">
                קוד תשלום
                <input type="text" readOnly className="payment-modal-inp payment-modal-inp--ro" dir="ltr" value={paymentCodeDisp} />
              </label>

              <div className="payment-modal-pay-grid" aria-label="סכומי תשלום">
                <label className="payment-modal-lbl payment-modal-lbl--rowfield">
                  שולם דולר
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    className="payment-modal-inp payment-modal-inp--num"
                    value={usdPaid}
                    onChange={(e) => setUsdPaid(sanitizeMoneyInput(e.target.value))}
                  />
                </label>
                <label className="payment-modal-lbl payment-modal-lbl--rowfield">
                  שולם ש״ח
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    className="payment-modal-inp payment-modal-inp--num"
                    value={ilsPaid}
                    onChange={(e) => setIlsPaid(sanitizeMoneyInput(e.target.value))}
                  />
                </label>
                <label className="payment-modal-lbl payment-modal-lbl--rowfield">
                  שולם העברה
                  <input
                    inputMode="decimal"
                    dir="ltr"
                    className="payment-modal-inp payment-modal-inp--num"
                    value={transferPaid}
                    onChange={(e) => setTransferPaid(sanitizeMoneyInput(e.target.value))}
                  />
                </label>
                <label className="payment-modal-lbl payment-modal-lbl--rowfield">
                  העברה ללא מע״מ (₪)
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    className="payment-modal-inp payment-modal-inp--ro payment-modal-inp--num"
                    dir="ltr"
                    value={fmtFooterAmount(transferNoVatIls)}
                    aria-live="polite"
                  />
                </label>

                <div className="payment-modal-pay-grid-total">
                  <Card className="payment-modal-total-ds">
                    <div className="payment-modal-total payment-modal-total--compact payment-modal-total--pay-only" aria-live="polite">
                      <div className="payment-modal-total-lbl">סה״כ שולם (USD)</div>
                      <div className="payment-modal-total-val" dir="ltr">
                        {fmtUsdDisplay(totalUsdLive)}
                      </div>
                    </div>
                  </Card>
                </div>
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
