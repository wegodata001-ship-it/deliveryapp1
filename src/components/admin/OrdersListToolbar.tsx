"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { PaymentMethod } from "@prisma/client";
import { IntakeLocationCombobox } from "@/components/admin/IntakeLocationCombobox";
import { AhWeekNavNextButton, AhWeekNavPrevButton } from "@/components/admin/AhWeekNavButtons";
import { shiftAhWeekCode } from "@/lib/weeks/ah-week-nav";
import { ORDER_CAPTURE_PAYMENT_SPLIT_OPTIONS } from "@/lib/order-capture-payment-methods";
import { ORDER_COUNTRY_CODES, orderCountryLabel, type OrderCountryCode } from "@/lib/order-countries";
import { OS } from "@/lib/order-status-slugs";
import {
  getAhWeekCodeFromDateRange,
  getAhWeekRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";
import { useOrderStatusCatalog } from "@/components/admin/OrderStatusCatalogProvider";

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
  ahWeekSelect: string;
  activePreset: string | null;
  search: string;
  customerCode: string;
  customerName: string;
  ordersOrderNum: string;
  customerPhone: string;
  statusFilter: string;
  countryFilter: string;
  createdById: string;
  createdByOptions: OrdersCreatedByOption[];
  paymentType: string;
  paymentLocation: string;
  paymentLocationOptions: OrdersPaymentLocationOption[];
  amountMin: string;
  amountMax: string;
  ordersOpenOnly: boolean;
  ordersReadyOnly: boolean;
  leadingActions?: ReactNode;
  exportActions?: ReactNode;
};

export type OrdersListToolbarProps = Props;

const ORDERS_KEYS = [
  "ordersWeek",
  "ordersFrom",
  "ordersTo",
  "ordersPreset",
  "preset",
  "q",
  "ordersCode",
  "ordersName",
  "ordersOrderNum",
  "ordersPhone",
  "status",
  "ordersCountry",
  "createdBy",
  "paymentType",
  "paymentLocation",
  "amountMin",
  "amountMax",
  "ordersOpenOnly",
  "ordersReadyOnly",
  "page",
] as const;

const GLOBAL_KEYS = ["week", "from", "to", "country"] as const;

export function OrdersListToolbar({
  fromYmd,
  toYmd,
  ahWeekSelect,
  activePreset: _activePreset,
  search,
  customerCode,
  customerName,
  ordersOrderNum,
  customerPhone,
  statusFilter,
  countryFilter,
  createdById,
  createdByOptions,
  paymentType,
  paymentLocation,
  paymentLocationOptions,
  amountMin,
  amountMax,
  ordersOpenOnly,
  ordersReadyOnly,
  leadingActions,
  exportActions,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { options: STATUS_OPTIONS } = useOrderStatusCatalog();
  const [filterOpen, setFilterOpen] = useState(false);
  const [from, setFrom] = useState(fromYmd);
  const [to, setTo] = useState(toYmd);
  const [week, setWeek] = useState(() => (ahWeekSelect ? ahWeekSelect : ""));
  const [qDraft, setQDraft] = useState(search);
  const [codeDraft, setCodeDraft] = useState(customerCode);
  const [nameDraft, setNameDraft] = useState(customerName);
  const [orderNumDraft, setOrderNumDraft] = useState(ordersOrderNum);
  const [phoneDraft, setPhoneDraft] = useState(customerPhone);
  const [statusSel, setStatusSel] = useState(statusFilter);
  const [countrySel, setCountrySel] = useState(countryFilter);
  const [createdBySel, setCreatedBySel] = useState(createdById);
  const [payType, setPayType] = useState(paymentType);
  const [payLoc, setPayLoc] = useState(paymentLocation);
  const [minAmount, setMinAmount] = useState(amountMin);
  const [maxAmount, setMaxAmount] = useState(amountMax);
  const [openOnly, setOpenOnly] = useState(ordersOpenOnly);
  const [readyOnly, setReadyOnly] = useState(ordersReadyOnly);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setFrom(fromYmd);
    setTo(toYmd);
    setWeek(ahWeekSelect ? ahWeekSelect : "");
  }, [fromYmd, toYmd, ahWeekSelect]);

  useEffect(() => {
    setQDraft(search);
  }, [search]);

  useEffect(() => {
    setCodeDraft(customerCode);
    setNameDraft(customerName);
    setOrderNumDraft(ordersOrderNum);
    setPhoneDraft(customerPhone);
    setStatusSel(statusFilter);
    setCountrySel(countryFilter);
    setCreatedBySel(createdById);
    setPayType(paymentType);
    setPayLoc(paymentLocation);
    setMinAmount(amountMin);
    setMaxAmount(amountMax);
    setOpenOnly(ordersOpenOnly);
    setReadyOnly(ordersReadyOnly);
  }, [
    customerCode,
    customerName,
    ordersOrderNum,
    customerPhone,
    statusFilter,
    countryFilter,
    createdById,
    paymentType,
    paymentLocation,
    amountMin,
    amountMax,
    ordersOpenOnly,
    ordersReadyOnly,
  ]);

  const setRangeFromWeekCode = useCallback((code: string) => {
    const norm = normalizeAhWeekCode(code);
    if (!norm) return;
    const r = getAhWeekRange(norm);
    if (!r) return;
    setWeek(norm);
    setFrom(r.from);
    setTo(r.to);
  }, []);

  const shiftWeek = useCallback(
    (delta: -1 | 1) => {
      const base = week || ahWeekSelect || "AH-1";
      const next = shiftAhWeekCode(base, delta);
      if (!next) return;
      setRangeFromWeekCode(next);
    },
    [week, ahWeekSelect, setRangeFromWeekCode],
  );

  const pushFilters = useCallback(
    (overrides?: Partial<{
      from: string;
      to: string;
      week: string;
      qDraft: string;
      codeDraft: string;
      nameDraft: string;
      orderNumDraft: string;
      phoneDraft: string;
      statusSel: string;
      countrySel: string;
      createdBySel: string;
      payType: string;
      payLoc: string;
      minAmount: string;
      maxAmount: string;
      openOnly: boolean;
      readyOnly: boolean;
    }>) => {
      const s = {
        from,
        to,
        week,
        qDraft,
        codeDraft,
        nameDraft,
        orderNumDraft,
        phoneDraft,
        statusSel,
        countrySel,
        createdBySel,
        payType,
        payLoc,
        minAmount,
        maxAmount,
        openOnly,
        readyOnly,
        ...overrides,
      };

      const base = new URLSearchParams(searchParams.toString());
      for (const k of ORDERS_KEYS) base.delete(k);

      const ow = s.week.trim();
      if (ow && getAhWeekRange(ow)) {
        const r = getAhWeekRange(ow)!;
        base.set("ordersWeek", ow);
        base.set("ordersFrom", (s.from.trim() || r.from).slice(0, 10));
        base.set("ordersTo", (s.to.trim() || r.to).slice(0, 10));
      } else {
        if (s.from.trim()) base.set("ordersFrom", s.from.trim());
        if (s.to.trim()) base.set("ordersTo", s.to.trim());
      }

      if (s.qDraft.trim()) base.set("q", s.qDraft.trim());
      if (s.codeDraft.trim()) base.set("ordersCode", s.codeDraft.trim());
      if (s.nameDraft.trim()) base.set("ordersName", s.nameDraft.trim());
      if (s.orderNumDraft.trim()) base.set("ordersOrderNum", s.orderNumDraft.trim());
      if (s.phoneDraft.trim()) base.set("ordersPhone", s.phoneDraft.trim());

      if (s.openOnly) {
        base.set("ordersOpenOnly", "1");
        base.set("status", OS.OPEN);
      } else if (s.readyOnly) {
        base.set("ordersReadyOnly", "1");
        base.set("status", OS.COMPLETED);
      } else if (s.statusSel.trim()) {
        base.set("status", s.statusSel.trim());
      }

      if (s.countrySel.trim()) base.set("ordersCountry", s.countrySel.trim());
      if (s.createdBySel.trim()) base.set("createdBy", s.createdBySel.trim());
      if (s.payType.trim()) base.set("paymentType", s.payType.trim());
      if (s.payLoc.trim()) base.set("paymentLocation", s.payLoc.trim());
      if (s.minAmount.trim()) base.set("amountMin", s.minAmount.trim());
      if (s.maxAmount.trim()) base.set("amountMax", s.maxAmount.trim());

      const qs = base.toString();
      router.push(qs ? `/admin/orders?${qs}` : "/admin/orders");
    },
    [
      countrySel,
      createdBySel,
      codeDraft,
      from,
      maxAmount,
      minAmount,
      nameDraft,
      openOnly,
      orderNumDraft,
      payLoc,
      payType,
      phoneDraft,
      qDraft,
      readyOnly,
      router,
      searchParams,
      statusSel,
      to,
      week,
    ],
  );

  const schedulePush = useCallback(
    (overrides?: Parameters<typeof pushFilters>[0]) => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = undefined;
        pushFilters(overrides);
      }, 300);
    },
    [pushFilters],
  );

  useEffect(
    () => () => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const clearFilters = useCallback(() => {
    const base = new URLSearchParams();
    for (const k of GLOBAL_KEYS) {
      const v = searchParams.get(k);
      if (v) base.set(k, v);
    }
    const qs = base.toString();
    router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders");
  }, [router, searchParams]);

  const onWeekCommitted = useCallback(
    (code: string) => {
      const norm = normalizeAhWeekCode(code);
      if (norm) {
        setRangeFromWeekCode(norm);
        const r = getAhWeekRange(norm)!;
        pushFilters({ week: norm, from: r.from, to: r.to });
      } else {
        setWeek("");
        pushFilters({ week: "" });
      }
    },
    [pushFilters, setRangeFromWeekCode],
  );

  return (
    <div className="adm-orders-filters-bar adm-orders-filters-bar--split">
      <div className="adm-orders-toolbar-row adm-orders-toolbar-row--primary" dir="rtl">
        <label className="adm-orders-filter-field adm-orders-filter-field--week">
          <span className="adm-orders-filter-label">שבוע עבודה</span>
          <div className="adm-week-control" dir="ltr">
            <AhWeekNavPrevButton
              className="adm-week-step"
              onClick={() => {
                const base = week || ahWeekSelect || "AH-1";
                const next = shiftAhWeekCode(base, -1);
                if (!next) return;
                setRangeFromWeekCode(next);
                const r = getAhWeekRange(next)!;
                pushFilters({ week: next, from: r.from, to: r.to });
              }}
            />
            <input
              type="text"
              inputMode="text"
              value={week}
              dir="ltr"
              onChange={(e) => setWeek(e.target.value.toUpperCase())}
              onBlur={(e) => onWeekCommitted(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onWeekCommitted((e.target as HTMLInputElement).value);
              }}
              className="adm-week-inp"
              placeholder="AH-119"
              spellCheck={false}
              autoComplete="off"
            />
            <AhWeekNavNextButton
              className="adm-week-step"
              onClick={() => {
                const base = week || ahWeekSelect || "AH-1";
                const next = shiftAhWeekCode(base, 1);
                if (!next) return;
                setRangeFromWeekCode(next);
                const r = getAhWeekRange(next)!;
                pushFilters({ week: next, from: r.from, to: r.to });
              }}
            />
          </div>
        </label>

        <label className="adm-orders-filter-field adm-orders-filter-field--status">
          <span className="adm-orders-filter-label">סטטוס</span>
          <select
            value={openOnly ? OS.OPEN : readyOnly ? OS.COMPLETED : statusSel}
            disabled={openOnly || readyOnly}
            onChange={(e) => {
              const v = e.target.value;
              setOpenOnly(false);
              setReadyOnly(false);
              setStatusSel(v);
              pushFilters({ statusSel: v, openOnly: false, readyOnly: false });
            }}
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

        <label className="adm-orders-filter-field adm-orders-filter-field--cust-code">
          <span className="adm-orders-filter-label">קוד לקוח</span>
          <input
            type="text"
            value={codeDraft}
            dir="ltr"
            onChange={(e) => {
              const v = e.target.value;
              setCodeDraft(v);
              schedulePush({ codeDraft: v });
            }}
            className="adm-orders-filter-inp adm-orders-filter-inp--compact"
            autoComplete="off"
          />
        </label>

        <label className="adm-orders-filter-field adm-orders-filter-field--cust-name">
          <span className="adm-orders-filter-label">שם לקוח</span>
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => {
              const v = e.target.value;
              setNameDraft(v);
              schedulePush({ nameDraft: v });
            }}
            className="adm-orders-filter-inp adm-orders-filter-inp--compact"
            autoComplete="off"
          />
        </label>

        <label className="adm-orders-filter-field adm-orders-filter-field--created-by">
          <span className="adm-orders-filter-label">עובד שפתח הזמנה</span>
          <select
            value={createdBySel}
            onChange={(e) => {
              const v = e.target.value;
              setCreatedBySel(v);
              pushFilters({ createdBySel: v });
            }}
            className="adm-orders-week-sel adm-orders-sel-arrow"
          >
            <option value="">הכל</option>
            {createdByOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="adm-orders-filter-field adm-orders-filter-field--search adm-orders-filter-field--search-main">
          <span className="adm-orders-filter-label">חיפוש</span>
          <input
            type="search"
            value={qDraft}
            onChange={(e) => {
              const v = e.target.value;
              setQDraft(v);
              schedulePush({ qDraft: v });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
                pushFilters({ qDraft });
              }
            }}
            className="adm-orders-filter-inp adm-orders-filter-inp--search"
            placeholder="חיפוש הזמנה, לקוח, קוד לקוח..."
          />
        </label>

        <div className="adm-orders-filter-actions">
          {leadingActions}
          {exportActions}
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={clearFilters}>
            נקה
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs adm-orders-advanced-toggle"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            {filterOpen ? "✕ סגור סינון מתקדם" : "🔍 סינון מתקדם"}
          </button>
        </div>
      </div>

      {filterOpen ? (
        <div className="adm-orders-advanced-filters" dir="rtl">
          <label className="adm-orders-filter-field">
            <span className="adm-orders-filter-label">מספר הזמנה</span>
            <input
              type="text"
              value={orderNumDraft}
              dir="ltr"
              onChange={(e) => {
                const v = e.target.value;
                setOrderNumDraft(v);
                schedulePush({ orderNumDraft: v });
              }}
              className="adm-orders-filter-inp"
              autoComplete="off"
            />
          </label>

          <label className="adm-orders-filter-field">
            <span className="adm-orders-filter-label">טלפון לקוח</span>
            <input
              type="tel"
              value={phoneDraft}
              dir="ltr"
              onChange={(e) => {
                const v = e.target.value;
                setPhoneDraft(v);
                schedulePush({ phoneDraft: v });
              }}
              className="adm-orders-filter-inp"
              autoComplete="off"
            />
          </label>

          <label className="adm-orders-filter-field adm-orders-filter-field--country">
            <span className="adm-orders-filter-label">מדינת מקור</span>
            <select
              value={countrySel}
              onChange={(e) => {
                const v = e.target.value as OrderCountryCode | "";
                setCountrySel(v);
                pushFilters({ countrySel: v });
              }}
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

          <label className="adm-orders-filter-field adm-orders-filter-field--pay-type">
            <span className="adm-orders-filter-label">צורת תשלום</span>
            <select
              value={payType}
              onChange={(e) => {
                const v = e.target.value;
                setPayType(v);
                pushFilters({ payType: v });
              }}
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

          <label className="adm-orders-filter-field adm-orders-filter-field--pay-loc">
            <span className="adm-orders-filter-label">מקום תשלום</span>
            <IntakeLocationCombobox
              variant="filter"
              className="adm-orders-payloc-filter"
              inputClassName="adm-orders-week-sel adm-orders-sel-arrow"
              value={payLoc}
              label={
                payLoc === "NONE"
                  ? "ללא"
                  : payLoc
                    ? (paymentLocationOptions.find((p) => p.id === payLoc)?.label ?? "")
                    : ""
              }
              allowEmpty
              emptyLabel="הכל"
              extraEmptyOptions={[{ value: "NONE", label: "ללא" }]}
              onChange={(id) => {
                setPayLoc(id);
                pushFilters({ payLoc: id });
              }}
            />
          </label>

          <label className="adm-orders-filter-field">
            <span className="adm-orders-filter-label">סכום מינימום ($)</span>
            <input
              type="text"
              inputMode="decimal"
              value={minAmount}
              dir="ltr"
              onChange={(e) => {
                const v = e.target.value;
                setMinAmount(v);
                schedulePush({ minAmount: v });
              }}
              className="adm-orders-filter-inp"
            />
          </label>

          <label className="adm-orders-filter-field">
            <span className="adm-orders-filter-label">סכום מקסימום ($)</span>
            <input
              type="text"
              inputMode="decimal"
              value={maxAmount}
              dir="ltr"
              onChange={(e) => {
                const v = e.target.value;
                setMaxAmount(v);
                schedulePush({ maxAmount: v });
              }}
              className="adm-orders-filter-inp"
            />
          </label>

          <label className="adm-orders-filter-field adm-orders-filter-field--date">
            <span className="adm-orders-filter-label">תאריך מ-</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                const nextFrom = e.target.value;
                setFrom(nextFrom);
                const wk = getAhWeekCodeFromDateRange(nextFrom, to);
                const nextWeek = wk ?? "";
                setWeek(nextWeek);
                pushFilters({ from: nextFrom, week: nextWeek });
              }}
              className="adm-orders-date-inp"
            />
          </label>

          <label className="adm-orders-filter-field adm-orders-filter-field--date">
            <span className="adm-orders-filter-label">תאריך עד</span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                const nextTo = e.target.value;
                setTo(nextTo);
                const wk = getAhWeekCodeFromDateRange(from, nextTo);
                const nextWeek = wk ?? "";
                setWeek(nextWeek);
                pushFilters({ to: nextTo, week: nextWeek });
              }}
              className="adm-orders-date-inp"
            />
          </label>

          <label className="adm-orders-filter-field adm-orders-filter-field--check">
            <span className="adm-orders-filter-check">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setOpenOnly(checked);
                  if (checked) {
                    setReadyOnly(false);
                    setStatusSel(OS.OPEN);
                    pushFilters({ openOnly: true, readyOnly: false, statusSel: OS.OPEN });
                  } else {
                    pushFilters({ openOnly: false });
                  }
                }}
              />
              הזמנות פתוחות בלבד
            </span>
          </label>

          <label className="adm-orders-filter-field adm-orders-filter-field--check">
            <span className="adm-orders-filter-check">
              <input
                type="checkbox"
                checked={readyOnly}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setReadyOnly(checked);
                  if (checked) {
                    setOpenOnly(false);
                    setStatusSel(OS.COMPLETED);
                    pushFilters({ readyOnly: true, openOnly: false, statusSel: OS.COMPLETED });
                  } else {
                    pushFilters({ readyOnly: false });
                  }
                }}
              />
              הזמנות מוכנות בלבד
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
