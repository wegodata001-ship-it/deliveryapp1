"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrderStatus, PaymentMethod } from "@prisma/client";
import { ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS } from "@/lib/order-capture-payment-methods";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import {
  WORK_WEEK_CODES_SORTED,
  WORK_WEEK_RANGES,
  getAhWeekCodeFromDateRange,
  getAhWeekRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";

export type OrdersCreatedByOption = {
  id: string;
  label: string;
};

type Props = {
  fromYmd: string;
  toYmd: string;
  /** ערך לבחירת שבוע AH פנימי (ריק = טווח מותאם) */
  ahWeekSelect: string;
  activePreset: string | null;
  search: string;
  statusFilter: string;
  countryFilter: string;
  createdById: string;
  createdByOptions: OrdersCreatedByOption[];
  paymentType: string;
  amountMin: string;
  amountMax: string;
};

const ORDERS_KEYS = [
  "ordersWeek",
  "ordersFrom",
  "ordersTo",
  "ordersPreset",
  "preset",
  "q",
  "status",
  "ordersCountry",
  "createdBy",
  "paymentType",
  "amountMin",
  "amountMax",
] as const;

const GLOBAL_KEYS = ["week", "from", "to", "country"] as const;

function buildSearch(sp: URLSearchParams, patch: Record<string, string | undefined>) {
  const n = new URLSearchParams(sp.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") n.delete(k);
    else n.set(k, v);
  }
  const q = n.toString();
  return q;
}

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: OrderStatus.OPEN, label: "פתוחה" },
  { value: OrderStatus.WAITING_FOR_EXECUTION, label: "בטיפול" },
  { value: OrderStatus.COMPLETED, label: "הושלמה" },
];

export function OrdersListToolbar({
  fromYmd,
  toYmd,
  ahWeekSelect,
  activePreset,
  search,
  statusFilter,
  countryFilter,
  createdById,
  createdByOptions,
  paymentType,
  amountMin,
  amountMax,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(fromYmd);
  const [to, setTo] = useState(toYmd);
  const [week, setWeek] = useState(() => (ahWeekSelect ? ahWeekSelect : ""));
  const [qDraft, setQDraft] = useState(search);
  const [statusSel, setStatusSel] = useState(statusFilter);
  const [countrySel, setCountrySel] = useState(countryFilter);
  const [createdBy, setCreatedBy] = useState(createdById);
  const [payType, setPayType] = useState(paymentType);
  const [minAmount, setMinAmount] = useState(amountMin);
  const [maxAmount, setMaxAmount] = useState(amountMax);
  const searchDebounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setFrom(fromYmd);
    setTo(toYmd);
    setWeek(ahWeekSelect ? ahWeekSelect : "");
  }, [fromYmd, toYmd, ahWeekSelect]);

  useEffect(() => {
    setQDraft(search);
  }, [search]);

  useEffect(() => {
    setStatusSel(statusFilter);
    setCountrySel(countryFilter);
    setCreatedBy(createdById);
    setPayType(paymentType);
    setMinAmount(amountMin);
    setMaxAmount(amountMax);
  }, [statusFilter, countryFilter, createdById, paymentType, amountMin, amountMax]);

  const setRangeFromWeekCode = useCallback((code: string) => {
    const norm = normalizeAhWeekCode(code);
    if (!norm) return;
    const r = getAhWeekRange(norm);
    if (!r) return;
    setWeek(norm);
    setFrom(r.from);
    setTo(r.to);
  }, []);

  const flushSearchToUrl = useCallback(
    (value: string) => {
      const base = new URLSearchParams(searchParams.toString());
      const t = value.trim();
      if (t) base.set("q", t);
      else base.delete("q");
      const qs = base.toString();
      router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders");
    },
    [router, searchParams],
  );

  const scheduleSearchUrl = useCallback(
    (value: string) => {
      if (searchDebounceRef.current !== undefined) window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = window.setTimeout(() => {
        searchDebounceRef.current = undefined;
        flushSearchToUrl(value);
      }, 300);
    },
    [flushSearchToUrl],
  );

  useEffect(
    () => () => {
      if (searchDebounceRef.current !== undefined) window.clearTimeout(searchDebounceRef.current);
    },
    [],
  );

  const applyFilters = useCallback(() => {
    const base = new URLSearchParams(searchParams.toString());
    for (const k of ORDERS_KEYS) base.delete(k);

    const ow = week.trim();
    if (ow && getAhWeekRange(ow)) {
      const r = getAhWeekRange(ow)!;
      base.set("ordersWeek", ow);
      base.set("ordersFrom", (from.trim() || r.from).slice(0, 10));
      base.set("ordersTo", (to.trim() || r.to).slice(0, 10));
    } else {
      if (from.trim()) base.set("ordersFrom", from.trim());
      if (to.trim()) base.set("ordersTo", to.trim());
    }

    if (qDraft.trim()) base.set("q", qDraft.trim());
    if (statusSel.trim()) base.set("status", statusSel.trim());
    if (countrySel.trim()) base.set("ordersCountry", countrySel.trim());
    if (createdBy.trim()) base.set("createdBy", createdBy.trim());
    if (payType.trim()) base.set("paymentType", payType.trim());
    if (minAmount.trim()) base.set("amountMin", minAmount.trim());
    if (maxAmount.trim()) base.set("amountMax", maxAmount.trim());

    const qs = base.toString();
    router.push(qs ? `/admin/orders?${qs}` : "/admin/orders");
  }, [
    countrySel,
    createdBy,
    from,
    maxAmount,
    minAmount,
    payType,
    qDraft,
    router,
    searchParams,
    statusSel,
    to,
    week,
  ]);

  const clearFilters = useCallback(() => {
    const base = new URLSearchParams();
    for (const k of GLOBAL_KEYS) {
      const v = searchParams.get(k);
      if (v) base.set(k, v);
    }
    const qs = base.toString();
    router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders");
    router.refresh();
  }, [router, searchParams]);

  const presetHref = (preset: string) => {
    const n = new URLSearchParams(searchParams.toString());
    for (const k of ORDERS_KEYS) n.delete(k);
    n.set("ordersPreset", preset);
    const qs = n.toString();
    return qs ? `/admin/orders?${qs}` : "/admin/orders";
  };

  return (
    <div className="adm-orders-excel-toolbar">
      <div className="adm-orders-excel-filters">
        <p className="adm-orders-toolbar-scope-hint" dir="rtl">
          סינון זה משפיע רק על רשימת ההזמנות (לא משנה את שבוע המערכת הגלובלי למעלה).
        </p>
        <label className="adm-orders-filter-field adm-orders-filter-field--search">
          <span className="adm-orders-filter-label">חיפוש</span>
          <input
            type="search"
            value={qDraft}
            onChange={(e) => {
              const v = e.target.value;
              setQDraft(v);
              scheduleSearchUrl(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (searchDebounceRef.current !== undefined) window.clearTimeout(searchDebounceRef.current);
                flushSearchToUrl(qDraft);
              }
            }}
            className="adm-orders-filter-inp"
            placeholder="מספר הזמנה · קוד לקוח · שם · עובד · טלפון · מדינה · AH-119"
          />
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">מתאריך</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              const nextFrom = e.target.value;
              setFrom(nextFrom);
              const wk = getAhWeekCodeFromDateRange(nextFrom, to);
              setWeek(wk ?? "");
            }}
            className="adm-orders-date-inp"
          />
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">עד תאריך</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              const nextTo = e.target.value;
              setTo(nextTo);
              const wk = getAhWeekCodeFromDateRange(from, nextTo);
              setWeek(wk ?? "");
            }}
            className="adm-orders-date-inp"
          />
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">שבוע (רשימה)</span>
          <select
            value={week}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                setWeek("");
                return;
              }
              setRangeFromWeekCode(v);
            }}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            <option value="">{weekSelectEmptyLabel(from, to)}</option>
            {WORK_WEEK_CODES_SORTED.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">סטטוס</span>
          <select
            value={statusSel}
            onChange={(e) => setStatusSel(e.target.value)}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            <option value="">הכל</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">מדינה</span>
          <select
            value={countrySel}
            onChange={(e) => setCountrySel(e.target.value as OrderCountryCode | "")}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            <option value="">כל המדינות</option>
            {ORDER_COUNTRY_CODES.map((c) => (
              <option key={c} value={c}>
                {orderCountryLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">פותח</span>
          <select
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            <option value="">כל העובדים</option>
            {createdByOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">צורת תשלום</span>
          <select value={payType} onChange={(e) => setPayType(e.target.value)} className="adm-orders-week-sel adm-orders-sel-arrow">
            <option value="">הכל</option>
            {ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="NONE">ללא</option>
          </select>
        </label>
        <label className="adm-orders-filter-field adm-orders-filter-field--amount">
          <span className="adm-orders-filter-label">סכום מ־</span>
          <input
            type="number"
            inputMode="decimal"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            className="adm-orders-filter-inp"
            placeholder="0"
          />
        </label>
        <label className="adm-orders-filter-field adm-orders-filter-field--amount">
          <span className="adm-orders-filter-label">עד</span>
          <input
            type="number"
            inputMode="decimal"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            className="adm-orders-filter-inp"
            placeholder="99999"
          />
        </label>
        <button type="button" className="adm-btn adm-btn--primary adm-btn--dense" onClick={applyFilters}>
          החל
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--dense" onClick={clearFilters}>
          ניקוי
        </button>
      </div>

      <div className="adm-orders-quick-presets" role="group" aria-label="סינון מהיר">
        <Link
          href={presetHref("today")}
          className={`adm-orders-preset${activePreset === "today" ? " adm-orders-preset--active" : ""}`}
        >
          היום
        </Link>
        <Link
          href={presetHref("this_week")}
          className={`adm-orders-preset${activePreset === "this_week" ? " adm-orders-preset--active" : ""}`}
        >
          השבוע
        </Link>
        <Link
          href={presetHref("last_week")}
          className={`adm-orders-preset${activePreset === "last_week" ? " adm-orders-preset--active" : ""}`}
        >
          שבוע קודם
        </Link>
      </div>
    </div>
  );
}

function weekSelectEmptyLabel(fromYmd: string, toYmd: string): string {
  if (!fromYmd || !toYmd) return "— לפי תאריכים —";
  const wk = getAhWeekCodeFromDateRange(fromYmd, toYmd);
  return wk ? "— לפי תאריכים —" : "טווח מותאם";
}
