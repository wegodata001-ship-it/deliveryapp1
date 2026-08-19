"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Settings, X } from "lucide-react";
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
const WEEK_PRESERVE_KEYS = ["ordersWeek", "ordersFrom", "ordersTo"] as const;

type ActiveFilterChip = {
  key: string;
  label: string;
  onRemove: () => void;
};

function formatYmdShort(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y.slice(2)}`;
}

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
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [from, setFrom] = useState(fromYmd);
  const [to, setTo] = useState(toYmd);
  const [week, setWeek] = useState(() => ordersWeekFromUrl || ahWeekSelect || "");
  const [customerDraft, setCustomerDraft] = useState(customerQuery || ordersOrderNum);
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
    setCustomerDraft(customerQuery || ordersOrderNum);
  }, [customerQuery, ordersOrderNum]);

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

  const statusLabelByValue = useMemo(() => {
    const map = new Map(STATUS_OPTIONS.map((s) => [s.value, s.label]));
    return (value: string) => map.get(value) ?? value;
  }, [STATUS_OPTIONS]);

  const paymentLabelByValue = useMemo(() => {
    const map = new Map(paymentFilterOptions.map((p) => [p.value, p.label]));
    return (value: string) => map.get(value) ?? value;
  }, [paymentFilterOptions]);

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
    for (const k of WEEK_PRESERVE_KEYS) {
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

  const weekRange = useMemo(() => {
    const code = normalizeAhWeekCode(week) ?? normalizeAhWeekCode(ordersWeekFromUrl) ?? "";
    return code ? getAhWeekRange(code) : null;
  }, [ordersWeekFromUrl, week]);

  const datesDifferFromWeek = useMemo(() => {
    if (!weekRange) return Boolean(from.trim() || to.trim());
    return from !== weekRange.from || to !== weekRange.to;
  }, [from, to, weekRange]);

  const advancedFilterCount = useMemo(() => {
    let count = 0;
    if (phoneDraft.trim()) count++;
    if (payLoc.trim()) count++;
    if (createdByValues.length > 0) count++;
    if (minAmount.trim()) count++;
    if (maxAmount.trim()) count++;
    if (orderNumDraft.trim()) count++;
    if (openOnly) count++;
    if (readyOnly) count++;
    if (datesDifferFromWeek) count++;
    return count;
  }, [
    createdByValues.length,
    datesDifferFromWeek,
    maxAmount,
    minAmount,
    openOnly,
    orderNumDraft,
    payLoc,
    phoneDraft,
    readyOnly,
  ]);

  const activeFilterChips = useMemo((): ActiveFilterChip[] => {
    const chips: ActiveFilterChip[] = [];
    const weekCode =
      normalizeAhWeekCode(week) ??
      normalizeAhWeekCode(ordersWeekFromUrl) ??
      normalizeAhWeekCode(ahWeekSelect) ??
      "";

    if (weekCode) {
      chips.push({
        key: "week",
        label: `שבוע ${weekCode}`,
        onRemove: () => {
          goToActiveWeek();
        },
      });
    }

    const ordersCompleted = searchParams.get("ordersCompleted");
    if (ordersCompleted === "done") {
      chips.push({
        key: "ordersCompleted",
        label: "הושלמו בלבד",
        onRemove: () => {
          const base = new URLSearchParams(searchParams.toString());
          base.delete("ordersCompleted");
          base.delete("page");
          const qs = base.toString();
          router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders");
        },
      });
    } else if (ordersCompleted === "not_done") {
      chips.push({
        key: "ordersCompleted",
        label: "לא הושלמו",
        onRemove: () => {
          const base = new URLSearchParams(searchParams.toString());
          base.delete("ordersCompleted");
          base.delete("page");
          const qs = base.toString();
          router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders");
        },
      });
    }

    if (customerDraft.trim()) {
      chips.push({
        key: "customer",
        label: `חיפוש: ${customerDraft.trim()}`,
        onRemove: () => {
          setCustomerDraft("");
          pushFilters({ customerDraft: "" });
        },
      });
    }

    if (!openOnly && !readyOnly && statusValues.length > 0) {
      const labels = statusValues.map(statusLabelByValue).join(", ");
      chips.push({
        key: "status",
        label: `סטטוס: ${labels}`,
        onRemove: () => {
          setStatusValues([]);
          pushFilters({ statusValues: [] });
        },
      });
    }

    if (countryValues.length > 0) {
      const labels = countryValues
        .map((v) => orderCountryLabelLocalized(v, uiLocale))
        .join(", ");
      chips.push({
        key: "country",
        label: `מדינה: ${labels}`,
        onRemove: () => {
          setCountryValues([]);
          pushFilters({ countryValues: [] });
        },
      });
    }

    if (paymentTypeValues.length > 0) {
      const labels = paymentTypeValues.map(paymentLabelByValue).join(", ");
      chips.push({
        key: "payment",
        label: `תשלום: ${labels}`,
        onRemove: () => {
          setPaymentTypeValues([]);
          pushFilters({ paymentTypeValues: [] });
        },
      });
    }

    if (datesDifferFromWeek && from && to) {
      chips.push({
        key: "dates",
        label: `${formatYmdShort(from)}–${formatYmdShort(to)}`,
        onRemove: () => {
          if (weekRange) {
            setFrom(weekRange.from);
            setTo(weekRange.to);
            pushFilters({ from: weekRange.from, to: weekRange.to, week });
          } else {
            setFrom("");
            setTo("");
            pushFilters({ from: "", to: "" });
          }
        },
      });
    }

    if (payLoc.trim()) {
      const payLabel =
        payLoc === "NONE"
          ? "ללא"
          : (paymentLocationOptions.find((p) => p.id === payLoc)?.label ?? payLoc);
      chips.push({
        key: "payLoc",
        label: `מקום תשלום: ${payLabel}`,
        onRemove: () => {
          setPayLoc("");
          pushFilters({ payLoc: "" });
        },
      });
    }

    if (createdByValues.length > 0) {
      const labels = createdByValues
        .map((id) => createdByFilterOptions.find((o) => o.value === id)?.label ?? id)
        .join(", ");
      chips.push({
        key: "createdBy",
        label: `עובד: ${labels}`,
        onRemove: () => {
          setCreatedByValues([]);
          pushFilters({ createdByValues: [] });
        },
      });
    }

    if (minAmount.trim()) {
      chips.push({
        key: "minAmount",
        label: `מינימום: $${minAmount.trim()}`,
        onRemove: () => {
          setMinAmount("");
          pushFilters({ minAmount: "" });
        },
      });
    }

    if (maxAmount.trim()) {
      chips.push({
        key: "maxAmount",
        label: `מקסימום: $${maxAmount.trim()}`,
        onRemove: () => {
          setMaxAmount("");
          pushFilters({ maxAmount: "" });
        },
      });
    }

    if (orderNumDraft.trim()) {
      chips.push({
        key: "orderNum",
        label: `מספר הזמנה: ${orderNumDraft.trim()}`,
        onRemove: () => {
          setOrderNumDraft("");
          pushFilters({ orderNumDraft: "" });
        },
      });
    }

    if (phoneDraft.trim()) {
      chips.push({
        key: "phone",
        label: `טלפון: ${phoneDraft.trim()}`,
        onRemove: () => {
          setPhoneDraft("");
          pushFilters({ phoneDraft: "" });
        },
      });
    }

    if (openOnly) {
      chips.push({
        key: "openOnly",
        label: "פתוחות בלבד",
        onRemove: () => {
          setOpenOnly(false);
          pushFilters({ openOnly: false });
        },
      });
    }

    if (readyOnly) {
      chips.push({
        key: "readyOnly",
        label: "בוצע בלבד",
        onRemove: () => {
          setReadyOnly(false);
          pushFilters({ readyOnly: false });
        },
      });
    }

    return chips;
  }, [
    countryValues,
    createdByFilterOptions,
    createdByValues,
    customerDraft,
    datesDifferFromWeek,
    from,
    maxAmount,
    minAmount,
    openOnly,
    orderNumDraft,
    payLoc,
    paymentLabelByValue,
    paymentLocationOptions,
    paymentTypeValues,
    phoneDraft,
    pushFilters,
    readyOnly,
    statusLabelByValue,
    statusValues,
    to,
    uiLocale,
    week,
    weekRange,
    ahWeekSelect,
    goToActiveWeek,
    ordersWeekFromUrl,
    router,
    searchParams,
  ]);

  const mobileFilterCount = useMemo(() => {
    let count = advancedFilterCount;
    if (statusValues.length > 0 || openOnly || readyOnly) count++;
    if (countryValues.length > 0) count++;
    if (paymentTypeValues.length > 0) count++;
    if (customerDraft.trim()) count++;
    return count;
  }, [
    advancedFilterCount,
    countryValues.length,
    customerDraft,
    openOnly,
    paymentTypeValues.length,
    readyOnly,
    statusValues.length,
  ]);

  const toggleAdvancedPanel = useCallback(() => {
    setFilterOpen((v) => !v);
    setMobileFilterOpen(false);
  }, []);

  const toggleMobileDrawer = useCallback(() => {
    setMobileFilterOpen((v) => !v);
    setFilterOpen(false);
  }, []);

  const closeMobileDrawer = useCallback(() => {
    setMobileFilterOpen(false);
  }, []);

  const weekControl = (
    <div className="adm-orders-filter-field adm-orders-filter-field--week adm-orders-week-compact">
      <div className="adm-week-control adm-week-control--compact" dir="ltr">
        <AhWeekNavPrevButton className="adm-week-step adm-week-step--compact" onClick={() => shiftWeekNav(-1)} />
        <input
          type="text"
          inputMode="text"
          value={week}
          dir="ltr"
          aria-label="שבוע עבודה"
          onChange={(e) => setWeek(e.target.value.toUpperCase())}
          onBlur={(e) => onWeekCommitted(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onWeekCommitted((e.target as HTMLInputElement).value);
          }}
          className="adm-week-inp adm-week-inp--compact"
          placeholder="AH-136"
          spellCheck={false}
          autoComplete="off"
        />
        <AhWeekNavNextButton className="adm-week-step adm-week-step--compact" onClick={() => shiftWeekNav(1)} />
      </div>
      <CurrentWorkWeekButton className="adm-week-current adm-week-current--compact" weekCode={week} onClick={goToActiveWeek} />
    </div>
  );

  const searchField = (
    <label className="adm-orders-filter-field adm-orders-filter-field--search">
      <span className="adm-orders-filter-label">חיפוש</span>
      <span className="adm-orders-search-wrap">
        <Search size={16} strokeWidth={2} aria-hidden className="adm-orders-search-wrap__icon" />
        <input
          type="search"
          value={customerDraft}
          onChange={(e) => {
            const v = e.target.value;
            setCustomerDraft(v);
            if (orderNumDraft.trim()) {
              setOrderNumDraft("");
              schedulePush({ customerDraft: v, orderNumDraft: "" });
            } else {
              schedulePush({ customerDraft: v });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
              pushFilters({ customerDraft, orderNumDraft: "" });
            }
          }}
          className="adm-orders-filter-inp adm-orders-filter-inp--search"
          placeholder="חיפוש לפי לקוח / קוד לקוח / מספר הזמנה / טלפון"
          autoComplete="off"
        />
      </span>
    </label>
  );

  const statusField = (
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
  );

  const paymentField = (
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
  );

  const countryField = (
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
  );

  const advancedFiltersPanel = (
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
  );

  const hasClearableFilters =
    activeFilterChips.length > 0 ||
    advancedFilterCount > 0 ||
    statusValues.length > 0 ||
    countryValues.length > 0 ||
    paymentTypeValues.length > 0;

  return (
    <div
      className={[
        "adm-orders-filters-card",
        filterOpen ? "adm-orders-filters-card--advanced-open" : "",
        mobileFilterOpen ? "adm-orders-filters-card--mobile-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="adm-orders-filters-card__filters" dir="rtl">
        {searchField}
        {countryField}
        {paymentField}
        {statusField}
        {weekControl}
      </div>

      <div className="adm-orders-filters-card__mobile" dir="rtl">
        {searchField}
        <div className="adm-orders-filters-card__mobile-bar">
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs adm-orders-filters-card__mobile-filters-btn"
            aria-expanded={mobileFilterOpen}
            onClick={toggleMobileDrawer}
          >
            <Settings size={15} strokeWidth={2} aria-hidden />
            מסננים{mobileFilterCount > 0 ? ` (${mobileFilterCount})` : ""}
          </button>
          {weekControl}
          {leadingActions}
        </div>
      </div>

      <div className="adm-orders-filters-card__actions" dir="rtl">
        <div className="adm-orders-filters-card__actions-primary">
          {leadingActions}
          {exportActions}
        </div>
        <div className="adm-orders-filters-card__actions-secondary">
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs adm-orders-filters-card__advanced-btn"
            aria-expanded={filterOpen}
            onClick={toggleAdvancedPanel}
          >
            <Settings size={15} strokeWidth={2} aria-hidden />
            סינון מתקדם{advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ""}
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--ghost adm-btn--xs adm-orders-filters-card__clear-btn"
            onClick={clearFilters}
            disabled={!hasClearableFilters}
          >
            נקה סינונים
          </button>
        </div>
      </div>

      {activeFilterChips.length > 0 ? (
        <div className="adm-orders-filters-card__chips" dir="rtl" aria-label="סינונים פעילים">
          <span className="adm-orders-filters-card__chips-label">פעילים:</span>
          <div className="adm-orders-filters-card__chips-list">
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="adm-orders-filter-chip"
                onClick={chip.onRemove}
                title="הסר סינון"
              >
                <span>{chip.label}</span>
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            ))}
          </div>
          <button type="button" className="adm-orders-filters-card__chips-clear" onClick={clearFilters}>
            נקה הכל
          </button>
        </div>
      ) : null}

      {filterOpen ? (
        <div className="adm-orders-filters-card__advanced">{advancedFiltersPanel}</div>
      ) : null}

      {mobileFilterOpen ? (
        <>
          <button
            type="button"
            className="adm-orders-mobile-drawer-backdrop"
            aria-label="סגור סינון"
            onClick={closeMobileDrawer}
          />
          <div className="adm-orders-mobile-drawer" dir="rtl" role="dialog" aria-modal="true">
            <div className="adm-orders-mobile-drawer__head">
              <strong>סינון הזמנות</strong>
              <button
                type="button"
                className="adm-btn adm-btn--ghost adm-btn--xs"
                onClick={closeMobileDrawer}
                aria-label="סגור"
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div className="adm-orders-mobile-drawer__body">
              {statusField}
              {paymentField}
              {countryField}
              {advancedFiltersPanel}
            </div>
            <div className="adm-orders-mobile-drawer__foot">
              <button type="button" className="adm-btn adm-btn--ghost adm-btn--xs" onClick={clearFilters}>
                נקה הכל
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--primary adm-btn--xs"
                onClick={closeMobileDrawer}
              >
                הצג תוצאות
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
