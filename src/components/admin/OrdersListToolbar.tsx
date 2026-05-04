"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { OrderStatus, PaymentMethod } from "@prisma/client";
import { ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS } from "@/lib/order-capture-payment-methods";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import {
  WORK_WEEK_CODES_SORTED,
  WORK_WEEK_RANGES,
  getCurrentWeekYmdRange,
  getWeekCodeForLocalDate,
  parseLocalDate,
} from "@/lib/work-week";

export type OrdersCreatedByOption = {
  id: string;
  label: string;
};

type Props = {
  fromYmd: string;
  toYmd: string;
  weekCode: string;
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
  weekCode,
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
  const [week, setWeek] = useState(WORK_WEEK_RANGES[weekCode] ? weekCode : "");
  const [q, setQ] = useState(search);
  const [statusSel, setStatusSel] = useState(statusFilter);
  const [countrySel, setCountrySel] = useState(countryFilter);
  const [createdBy, setCreatedBy] = useState(createdById);
  const [payType, setPayType] = useState(paymentType);
  const [minAmount, setMinAmount] = useState(amountMin);
  const [maxAmount, setMaxAmount] = useState(amountMax);

  const applyFilters = useCallback(() => {
    const base = new URLSearchParams(searchParams.toString());
    base.delete("preset");
    const patch: Record<string, string> = {
      from: from.trim(),
      to: to.trim(),
      week: week.trim(),
      q: q.trim(),
      status: statusSel.trim(),
      country: countrySel.trim(),
      createdBy: createdBy.trim(),
      paymentType: payType.trim(),
      amountMin: minAmount.trim(),
      amountMax: maxAmount.trim(),
    };
    for (const [key, value] of Object.entries(patch)) {
      if (value) base.set(key, value);
      else base.delete(key);
    }
    base.delete("statuses");
    base.delete("countries");
    const queryString = base.toString();
    router.push(queryString ? `/admin/orders?${queryString}` : "/admin/orders");
  }, [createdBy, countrySel, from, maxAmount, minAmount, payType, q, router, searchParams, statusSel, to, week]);

  const clearFilters = useCallback(() => {
    const range = getCurrentWeekYmdRange();
    const defaultWeekCode = getWeekCodeForLocalDate(parseLocalDate(range.from));
    setFrom(range.from);
    setTo(range.to);
    setWeek(WORK_WEEK_RANGES[defaultWeekCode] ? defaultWeekCode : "");
    setQ("");
    setStatusSel("");
    setCountrySel("");
    setCreatedBy("");
    setPayType("");
    setMinAmount("");
    setMaxAmount("");
    router.replace("/admin/orders");
    router.refresh();
  }, [router]);

  const presetHref = (preset: string) => {
    const q = buildSearch(new URLSearchParams(searchParams.toString()), {
      preset,
      from: undefined,
      to: undefined,
      week: undefined,
      q: undefined,
      status: undefined,
      country: undefined,
      createdBy: undefined,
      paymentType: undefined,
      amountMin: undefined,
      amountMax: undefined,
      statuses: undefined,
      countries: undefined,
    });
    return q ? `/admin/orders?${q}` : "/admin/orders";
  };

  return (
    <div className="adm-orders-excel-toolbar">
      <div className="adm-orders-excel-filters">
        <label className="adm-orders-filter-field adm-orders-filter-field--search">
          <span className="adm-orders-filter-label">חיפוש</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters();
            }}
            className="adm-orders-filter-inp"
            placeholder="קוד / לקוח / סכום / עובד"
          />
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">מתאריך</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="adm-orders-date-inp" />
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">עד תאריך</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="adm-orders-date-inp" />
        </label>
        <label className="adm-orders-filter-field">
          <span className="adm-orders-filter-label">שבוע עבודה</span>
          <select value={week} onChange={(e) => setWeek(e.target.value)} className="adm-orders-week-sel adm-orders-sel-arrow">
            <option value="">— לפי תאריכים —</option>
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
