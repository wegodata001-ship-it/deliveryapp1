"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrderStatus, PaymentMethod } from "@prisma/client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS } from "@/lib/order-capture-payment-methods";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import {
  getAhWeekCodeFromDateRange,
  getAhWeekRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";
import { ORDER_STATUS_QUICK_SELECT_OPTIONS } from "@/constants/order-status";

export type OrdersCreatedByOption = {
  id: string;
  label: string;
};

export type OrdersPaymentLocationOption = {
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
  /** נשמר ב־props לתאימות עם page.tsx, אך לא מוצג ב־UI אחרי הניקוי */
  createdById: string;
  createdByOptions: OrdersCreatedByOption[];
  paymentType: string;
  paymentLocation: string;
  paymentLocationOptions: OrdersPaymentLocationOption[];
  /** נשמרים ב־props לתאימות עם page.tsx, אך לא מוצגים ב־UI אחרי הניקוי */
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
  "paymentLocation",
  "amountMin",
  "amountMax",
] as const;

/** הזזת קוד שבוע ב־±1 (AH-119 ↔ AH-120). מחזיר null אם הקלט לא תקין. */
function shiftAhWeek(code: string, delta: number): string | null {
  const norm = normalizeAhWeekCode(code) ?? code.trim().toUpperCase();
  const m = /^AH-(\d+)$/i.exec(norm);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `AH-${Math.max(1, Math.floor(n + delta))}`;
}

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

const STATUS_OPTIONS = ORDER_STATUS_QUICK_SELECT_OPTIONS;

export function OrdersListToolbar({
  fromYmd,
  toYmd,
  ahWeekSelect,
  activePreset,
  search,
  statusFilter,
  countryFilter,
  // createdById / createdByOptions / amountMin / amountMax — נשמרים בחוזה אך לא מוצגים יותר
  createdById,
  paymentType,
  paymentLocation,
  paymentLocationOptions,
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
  const [payType, setPayType] = useState(paymentType);
  const [payLoc, setPayLoc] = useState(paymentLocation);
  // createdBy / סכום מ-עד — נשמרים ב־state רק כדי שלא לאבד פרמטרי URL קיימים אם
  // נכנסים לדף עם URL ישן; אין UI שמגדיר אותם יותר.
  const [createdBy] = useState(createdById);
  const [minAmount] = useState(amountMin);
  const [maxAmount] = useState(amountMax);
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
    setPayType(paymentType);
    setPayLoc(paymentLocation);
  }, [statusFilter, countryFilter, paymentType, paymentLocation]);

  const setRangeFromWeekCode = useCallback((code: string) => {
    const norm = normalizeAhWeekCode(code);
    if (!norm) return;
    const r = getAhWeekRange(norm);
    if (!r) return;
    setWeek(norm);
    setFrom(r.from);
    setTo(r.to);
  }, []);

  /** שינוי שבוע ב־±1 (החצים ליד הקלט). */
  const shiftWeek = useCallback(
    (delta: number) => {
      const base = week || ahWeekSelect || "AH-1";
      const next = shiftAhWeek(base, delta);
      if (!next) return;
      setRangeFromWeekCode(next);
    },
    [week, ahWeekSelect, setRangeFromWeekCode],
  );

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
    if (payLoc.trim()) base.set("paymentLocation", payLoc.trim());
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
    payLoc,
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
      <div className="adm-orders-excel-filters adm-orders-excel-filters--v2">
        <label className="adm-orders-filter-field adm-orders-filter-field--week">
          <span className="adm-orders-filter-label">שבוע</span>
          <div className="adm-week-control">
            <button
              type="button"
              className="adm-week-step"
              aria-label="שבוע קודם"
              title="שבוע קודם"
              onClick={() => shiftWeek(-1)}
            >
              <ChevronRight size={14} strokeWidth={2.4} aria-hidden />
            </button>
            <input
              type="text"
              inputMode="text"
              value={week}
              dir="ltr"
              onChange={(e) => setWeek(e.target.value.toUpperCase())}
              onBlur={(e) => {
                const norm = normalizeAhWeekCode(e.target.value);
                if (norm) setRangeFromWeekCode(norm);
                else setWeek("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const norm = normalizeAhWeekCode((e.target as HTMLInputElement).value);
                  if (norm) setRangeFromWeekCode(norm);
                  else setWeek("");
                }
              }}
              className="adm-week-inp"
              placeholder="AH-119"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="adm-week-step"
              aria-label="שבוע הבא"
              title="שבוע הבא"
              onClick={() => shiftWeek(1)}
            >
              <ChevronLeft size={14} strokeWidth={2.4} aria-hidden />
            </button>
          </div>
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
          <span className="adm-orders-filter-label">צורת תשלום</span>
          <select
            value={payType}
            onChange={(e) => setPayType(e.target.value)}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            <option value="">הכל</option>
            {ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="NONE">ללא</option>
          </select>
        </label>

        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">מקום תשלום</span>
          <select
            value={payLoc}
            onChange={(e) => setPayLoc(e.target.value)}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            <option value="">הכל</option>
            {paymentLocationOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="NONE">ללא</option>
          </select>
        </label>

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
            className="adm-orders-filter-inp adm-orders-filter-inp--search"
            placeholder="מספר הזמנה · קוד לקוח · שם · טלפון"
          />
        </label>

        <div className="adm-orders-filter-actions">
          <button
            type="button"
            className="adm-orders-btn adm-orders-btn--apply"
            onClick={applyFilters}
          >
            חפש
          </button>
          <button
            type="button"
            className="adm-orders-btn adm-orders-btn--clear"
            onClick={clearFilters}
          >
            ניקוי
          </button>
        </div>
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
