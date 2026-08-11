"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { IntakeLocationCombobox } from "@/components/admin/IntakeLocationCombobox";
import { AhWeekNavNextButton, AhWeekNavPrevButton } from "@/components/admin/AhWeekNavButtons";
import {
  goToNextWeekNumber,
  goToPrevWeekNumber,
  parseAhWeekNumber,
  toAhWeekCode,
} from "@/lib/weeks/ah-week-nav";
import { usePaymentMethodCatalog } from "@/components/admin/PaymentMethodCatalogProvider";
import { orderCountryLabelLocalized } from "@/lib/order-countries";
import { OS } from "@/lib/order-status-slugs";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import { CurrentWorkWeekButton } from "@/components/admin/CurrentWorkWeekButton";
import {
  getAhWeekCodeFromDateRange,
  getAhWeekRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";
import { useOrderStatusCatalog } from "@/components/admin/OrderStatusCatalogProvider";
import { ShipmentMultiSelectFilter } from "@/components/admin/shipments/ShipmentMultiSelectFilter";
import { setMultiParam } from "@/lib/orders-list-filter-params";
import {
  ADMIN_UI_LOCALE_DIR,
  getMultiSelectUiStrings,
  readDocumentUiLocale,
  type AdminUiLocale,
} from "@/lib/admin-ui-locale";

export type OrdersCreatedByOption = {
  id: string;
  label: string;
};

export type OrdersPaymentLocationOption = {
  id: string;
  label: string;
};

export type OrdersCountryFilterOption = {
  value: string;
};

type Props = {
  fromYmd: string;
  toYmd: string;
  ahWeekSelect: string;
  activePreset: string | null;
  customerQuery: string;
  ordersOrderNum: string;
  customerPhone: string;
  statusFilter: string[];
  countryFilter: string[];
  createdByIds: string[];
  createdByOptions: OrdersCreatedByOption[];
  countryFilterOptions: OrdersCountryFilterOption[];
  paymentTypes: string[];
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
  "ordersCustomer",
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
  customerQuery,
  ordersOrderNum,
  customerPhone,
  statusFilter,
  countryFilter,
  createdByIds,
  createdByOptions,
  countryFilterOptions,
  paymentTypes,
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
  const { methods: PAYMENT_METHODS } = usePaymentMethodCatalog();
  const [uiLocale, setUiLocale] = useState<AdminUiLocale>("he");
  const msStrings = useMemo(() => getMultiSelectUiStrings(uiLocale), [uiLocale]);
  const msDir = ADMIN_UI_LOCALE_DIR[uiLocale];
  const ordersWeekFromUrl = (() => {
    const raw = searchParams.get("ordersWeek")?.trim() ?? "";
    return normalizeAhWeekCode(raw) ?? raw;
  })();
  const [filterOpen, setFilterOpen] = useState(false);
  const [from, setFrom] = useState(fromYmd);
  const [to, setTo] = useState(toYmd);
  const [week, setWeek] = useState(() => ordersWeekFromUrl || ahWeekSelect || "");
  const [customerDraft, setCustomerDraft] = useState(customerQuery);
  const [orderNumDraft, setOrderNumDraft] = useState(ordersOrderNum);
  const [phoneDraft, setPhoneDraft] = useState(customerPhone);
  const [statusValues, setStatusValues] = useState(statusFilter);
  const [countryValues, setCountryValues] = useState(countryFilter);
  const [createdByValues, setCreatedByValues] = useState(createdByIds);
  const [paymentTypeValues, setPaymentTypeValues] = useState(paymentTypes);
  const [payLoc, setPayLoc] = useState(paymentLocation);
  const [minAmount, setMinAmount] = useState(amountMin);
  const [maxAmount, setMaxAmount] = useState(amountMax);
  const [openOnly, setOpenOnly] = useState(ordersOpenOnly);
  const [readyOnly, setReadyOnly] = useState(ordersReadyOnly);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setFrom(fromYmd);
    setTo(toYmd);
    setWeek(ordersWeekFromUrl || ahWeekSelect || "");
  }, [fromYmd, toYmd, ahWeekSelect, ordersWeekFromUrl]);

  useEffect(() => {
    setCustomerDraft(customerQuery);
  }, [customerQuery]);

  useEffect(() => {
    setUiLocale(readDocumentUiLocale());
  }, []);

  useEffect(() => {
    setOrderNumDraft(ordersOrderNum);
    setPhoneDraft(customerPhone);
    setStatusValues(statusFilter);
    setCountryValues(countryFilter);
    setCreatedByValues(createdByIds);
    setPaymentTypeValues(paymentTypes);
    setPayLoc(paymentLocation);
    setMinAmount(amountMin);
    setMaxAmount(amountMax);
    setOpenOnly(ordersOpenOnly);
    setReadyOnly(ordersReadyOnly);
  }, [
    ordersOrderNum,
    customerPhone,
    statusFilter,
    countryFilter,
    createdByIds,
    paymentTypes,
    paymentLocation,
    amountMin,
    amountMax,
    ordersOpenOnly,
    ordersReadyOnly,
  ]);

  const createdByFilterOptions = useMemo(
    () => createdByOptions.map((o) => ({ value: o.id, label: o.label })),
    [createdByOptions],
  );

  const countryOptions = useMemo(
    () =>
      countryFilterOptions.map((o) => ({
        value: o.value,
        label: orderCountryLabelLocalized(o.value, uiLocale),
      })),
    [countryFilterOptions, uiLocale],
  );

  const paymentFilterOptions = useMemo(() => {
    const opts = PAYMENT_METHODS.filter((m) => m.isActive).map((m) => ({
      value: m.id,
      label:
        uiLocale === "ar" && m.nameAr
          ? m.nameAr
          : uiLocale === "en" && m.nameEn
            ? m.nameEn
            : m.nameHe,
    }));
    opts.push({
      value: "NONE",
      label: uiLocale === "ar" ? "بدون" : uiLocale === "en" ? "None" : "ללא",
    });
    return opts;
  }, [PAYMENT_METHODS, uiLocale]);

  const setRangeFromWeekCode = useCallback((code: string) => {
    const norm = normalizeAhWeekCode(code);
    if (!norm) return;
    const r = getAhWeekRange(norm);
    if (!r) return;
    setWeek(norm);
    setFrom(r.from);
    setTo(r.to);
  }, []);

  const pushFilters = useCallback(
    (
      overrides?: Partial<{
        from: string;
        to: string;
        week: string;
        customerDraft: string;
        orderNumDraft: string;
        phoneDraft: string;
        statusValues: string[];
        countryValues: string[];
        createdByValues: string[];
        paymentTypeValues: string[];
        payLoc: string;
        minAmount: string;
        maxAmount: string;
        openOnly: boolean;
        readyOnly: boolean;
      }>,
      opts?: { refresh?: boolean },
    ) => {
      const s = {
        from,
        to,
        week,
        customerDraft,
        orderNumDraft,
        phoneDraft,
        statusValues,
        countryValues,
        createdByValues,
        paymentTypeValues,
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

      if (s.customerDraft.trim()) base.set("ordersCustomer", s.customerDraft.trim());
      if (s.orderNumDraft.trim()) base.set("ordersOrderNum", s.orderNumDraft.trim());
      if (s.phoneDraft.trim()) base.set("ordersPhone", s.phoneDraft.trim());

      base.delete("ordersOpenOnly");
      base.delete("ordersReadyOnly");
      if (s.openOnly) {
        base.set("ordersOpenOnly", "1");
        setMultiParam(base, "status", [OS.OPEN]);
      } else if (s.readyOnly) {
        base.set("ordersReadyOnly", "1");
        setMultiParam(base, "status", [OS.COMPLETED]);
      } else {
        setMultiParam(base, "status", s.statusValues);
      }

      setMultiParam(base, "ordersCountry", s.countryValues);
      setMultiParam(base, "createdBy", s.createdByValues);
      setMultiParam(base, "paymentType", s.paymentTypeValues);
      if (s.payLoc.trim()) base.set("paymentLocation", s.payLoc.trim());
      if (s.minAmount.trim()) base.set("amountMin", s.minAmount.trim());
      if (s.maxAmount.trim()) base.set("amountMax", s.maxAmount.trim());

      const qs = base.toString();
      const path = qs ? `/admin/orders?${qs}` : "/admin/orders";
      router.replace(path, { scroll: false });
      if (opts?.refresh) router.refresh();
    },
    [
      countryValues,
      createdByValues,
      customerDraft,
      from,
      maxAmount,
      minAmount,
      openOnly,
      orderNumDraft,
      payLoc,
      paymentTypeValues,
      phoneDraft,
      readyOnly,
      router,
      searchParams,
      statusValues,
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
        pushFilters({ week: norm, from: r.from, to: r.to }, { refresh: true });
      } else {
        setWeek("");
        pushFilters({ week: "" }, { refresh: true });
      }
    },
    [pushFilters, setRangeFromWeekCode],
  );

  const shiftWeekNav = useCallback(
    (delta: -1 | 1) => {
      const baseCode =
        ordersWeekFromUrl ||
        normalizeAhWeekCode(week) ||
        normalizeAhWeekCode(ahWeekSelect) ||
        ahWeekSelect ||
        "AH-1";
      const n = parseAhWeekNumber(baseCode);
      if (n == null) return;
      const next = toAhWeekCode(delta === -1 ? goToPrevWeekNumber(n) : goToNextWeekNumber(n));
      const r = getAhWeekRange(next);
      if (!r) return;
      setRangeFromWeekCode(next);
      pushFilters({ week: next, from: r.from, to: r.to }, { refresh: true });
    },
    [ahWeekSelect, ordersWeekFromUrl, pushFilters, setRangeFromWeekCode, week],
  );

  const goToActiveWeek = useCallback(() => {
    const r = getAhWeekRange(ACTIVE_WORK_WEEK_CODE);
    if (!r) return;
    setRangeFromWeekCode(ACTIVE_WORK_WEEK_CODE);
    pushFilters({ week: ACTIVE_WORK_WEEK_CODE, from: r.from, to: r.to }, { refresh: true });
  }, [pushFilters, setRangeFromWeekCode]);

  return (
    <div className="adm-orders-filters-bar adm-orders-filters-bar--split adm-orders-filters-bar--compact">
      <div className="adm-orders-toolbar-row adm-orders-toolbar-row--primary" dir="rtl">
        <label className="adm-orders-filter-field adm-orders-filter-field--week">
          <span className="adm-orders-filter-label">שבוע עבודה</span>
          <div className="adm-week-control" dir="ltr">
            <AhWeekNavPrevButton
              className="adm-week-step"
              onClick={() => shiftWeekNav(-1)}
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
              onClick={() => shiftWeekNav(1)}
            />
            <CurrentWorkWeekButton className="adm-week-current" weekCode={week} onClick={goToActiveWeek} />
          </div>
        </label>

        <div className="adm-orders-filter-field adm-orders-filter-field--status">
          <ShipmentMultiSelectFilter
            label="סטטוס"
            options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
            values={openOnly ? [OS.OPEN] : readyOnly ? [OS.COMPLETED] : statusValues}
            onChange={(next) => {
              setOpenOnly(false);
              setReadyOnly(false);
              setStatusValues(next);
              pushFilters({ statusValues: next, openOnly: false, readyOnly: false });
            }}
            disabled={openOnly || readyOnly}
            strings={msStrings}
            dir={msDir}
          />
        </div>

        <label className="adm-orders-filter-field adm-orders-filter-field--customer">
          <span className="adm-orders-filter-label">לקוח / קוד לקוח</span>
          <input
            type="search"
            value={customerDraft}
            onChange={(e) => {
              const v = e.target.value;
              setCustomerDraft(v);
              schedulePush({ customerDraft: v });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
                pushFilters({ customerDraft });
              }
            }}
            className="adm-orders-filter-inp adm-orders-filter-inp--customer"
            placeholder="חיפוש לקוח או קוד לקוח..."
            autoComplete="off"
          />
        </label>

        <div className="adm-orders-filter-field adm-orders-filter-field--created-by">
          <ShipmentMultiSelectFilter
            label="עובד שפתח הזמנה"
            options={createdByFilterOptions}
            values={createdByValues}
            onChange={(next) => {
              setCreatedByValues(next);
              pushFilters({ createdByValues: next });
            }}
            strings={msStrings}
            dir={msDir}
          />
        </div>

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
            {filterOpen ? <><X size={16} strokeWidth={1.75} aria-hidden /> סגור סינון מתקדם</> : <><Search size={16} strokeWidth={1.75} aria-hidden /> סינון מתקדם</>}
          </button>
        </div>
      </div>

      {filterOpen ? (
        <div className="adm-orders-advanced-filters" dir="rtl">
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

          <label className="adm-orders-filter-field">
            <span className="adm-orders-filter-label">טלפון</span>
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

          <div className="adm-orders-filter-field adm-orders-filter-field--pay-type">
            <ShipmentMultiSelectFilter
              label="צורת תשלום"
              options={paymentFilterOptions}
              values={paymentTypeValues}
              onChange={(next) => {
                setPaymentTypeValues(next);
                pushFilters({ paymentTypeValues: next });
              }}
              strings={msStrings}
              dir={msDir}
            />
          </div>

          <div className="adm-orders-filter-field adm-orders-filter-field--country">
            <ShipmentMultiSelectFilter
              label="מדינה"
              options={countryOptions}
              values={countryValues}
              onChange={(next) => {
                setCountryValues(next);
                pushFilters({ countryValues: next });
              }}
              strings={msStrings}
              dir={msDir}
            />
          </div>

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
                    setStatusValues([OS.OPEN]);
                    pushFilters({ openOnly: true, readyOnly: false, statusValues: [OS.OPEN] });
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
                    setStatusValues([OS.COMPLETED]);
                    pushFilters({ readyOnly: true, openOnly: false, statusValues: [OS.COMPLETED] });
                  } else {
                    pushFilters({ readyOnly: false });
                  }
                }}
              />
              הזמנות בוצע בלבד
            </span>
          </label>
        </div>
      ) : null}
    </div>
  );
}
