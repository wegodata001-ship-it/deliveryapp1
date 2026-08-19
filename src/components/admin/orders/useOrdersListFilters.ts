"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOrderStatusCatalog } from "@/components/admin/OrderStatusCatalogProvider";
import { usePaymentMethodCatalog } from "@/components/admin/PaymentMethodCatalogProvider";
import { ACTIVE_WORK_WEEK_CODE } from "@/lib/active-work-week";
import {
  ADMIN_UI_LOCALE_DIR,
  getMultiSelectUiStrings,
  readDocumentUiLocale,
  type AdminUiLocale,
} from "@/lib/admin-ui-locale";
import {
  buildOrdersListSearchParams,
  clearOrdersFiltersSearchParams,
  countAdvancedFilters,
  parseOrderFiltersFromSearchParams,
  type OrderFilters,
} from "@/lib/orders-list-filters";
import { orderCountryLabelLocalized } from "@/lib/order-countries";
import { OS } from "@/lib/order-status-slugs";
import {
  getAhWeekCodeFromDateRange,
  getAhWeekRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";
import {
  goToNextWeekNumber,
  goToPrevWeekNumber,
  parseAhWeekNumber,
  toAhWeekCode,
} from "@/lib/weeks/ah-week-nav";

export type OrdersCreatedByOption = { id: string; label: string };
export type OrdersPaymentLocationOption = { id: string; label: string };
export type OrdersCountryFilterOption = { value: string };

export type UseOrdersListFiltersInput = {
  fromYmd: string;
  toYmd: string;
  ahWeekSelect: string;
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
};

function formatYmdShort(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y.slice(2)}`;
}

export type ActiveFilterChip = {
  key: string;
  label: string;
  onRemove: () => void;
};

export function useOrdersListFilters(input: UseOrdersListFiltersInput) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { options: STATUS_OPTIONS } = useOrderStatusCatalog();
  const { methods: PAYMENT_METHODS } = usePaymentMethodCatalog();
  const [uiLocale, setUiLocale] = useState<AdminUiLocale>("he");
  const msStrings = useMemo(() => getMultiSelectUiStrings(uiLocale), [uiLocale]);
  const msDir = ADMIN_UI_LOCALE_DIR[uiLocale];

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  const ordersWeekFromUrl = useMemo(() => {
    const raw = searchParams.get("ordersWeek")?.trim() ?? "";
    return normalizeAhWeekCode(raw) ?? raw;
  }, [searchParams]);

  const parsed = useMemo(
    () =>
      parseOrderFiltersFromSearchParams(Object.fromEntries(searchParams.entries()), {
        week: input.ahWeekSelect,
        dateFrom: input.fromYmd,
        dateTo: input.toYmd,
      }),
    [input.ahWeekSelect, input.fromYmd, input.toYmd, searchParams],
  );

  const [week, setWeek] = useState(() => ordersWeekFromUrl || input.ahWeekSelect || parsed.week);
  const [dateFrom, setDateFrom] = useState(parsed.dateFrom);
  const [dateTo, setDateTo] = useState(parsed.dateTo);
  const [searchDraft, setSearchDraft] = useState(input.customerQuery || input.ordersOrderNum);
  const [orderNumDraft, setOrderNumDraft] = useState(input.ordersOrderNum);
  const [phoneDraft, setPhoneDraft] = useState(input.customerPhone);
  const [statusValues, setStatusValues] = useState(input.statusFilter);
  const [countryValues, setCountryValues] = useState(input.countryFilter);
  const [createdByValues, setCreatedByValues] = useState(input.createdByIds);
  const [paymentTypeValues, setPaymentTypeValues] = useState(input.paymentTypes);
  const [payLoc, setPayLoc] = useState(input.paymentLocation);
  const [minAmount, setMinAmount] = useState(input.amountMin);
  const [maxAmount, setMaxAmount] = useState(input.amountMax);
  const [openOnly, setOpenOnly] = useState(input.ordersOpenOnly);
  const [completedOnly, setCompletedOnly] = useState(input.ordersReadyOnly);

  useEffect(() => {
    setWeek(ordersWeekFromUrl || input.ahWeekSelect || "");
    setDateFrom(input.fromYmd);
    setDateTo(input.toYmd);
  }, [input.ahWeekSelect, input.fromYmd, input.toYmd, ordersWeekFromUrl]);

  useEffect(() => {
    setSearchDraft(input.customerQuery || input.ordersOrderNum);
  }, [input.customerQuery, input.ordersOrderNum]);

  useEffect(() => {
    setOrderNumDraft(input.ordersOrderNum);
    setPhoneDraft(input.customerPhone);
    setStatusValues(input.statusFilter);
    setCountryValues(input.countryFilter);
    setCreatedByValues(input.createdByIds);
    setPaymentTypeValues(input.paymentTypes);
    setPayLoc(input.paymentLocation);
    setMinAmount(input.amountMin);
    setMaxAmount(input.amountMax);
    setOpenOnly(input.ordersOpenOnly);
    setCompletedOnly(input.ordersReadyOnly);
  }, [
    input.amountMax,
    input.amountMin,
    input.countryFilter,
    input.createdByIds,
    input.customerPhone,
    input.ordersOpenOnly,
    input.ordersOrderNum,
    input.ordersReadyOnly,
    input.paymentLocation,
    input.paymentTypes,
    input.statusFilter,
  ]);

  useEffect(() => {
    setUiLocale(readDocumentUiLocale());
  }, []);

  useEffect(
    () => () => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const toOrderFilters = useCallback(
    (overrides?: Partial<OrderFilters>): OrderFilters => ({
      week,
      dateFrom,
      dateTo,
      search: searchDraft,
      country: countryValues,
      paymentMethod: paymentTypeValues,
      status: statusValues,
      orderNumber: orderNumDraft,
      phone: phoneDraft,
      paymentLocation: payLoc,
      createdBy: createdByValues,
      minAmountUsd: minAmount,
      maxAmountUsd: maxAmount,
      openOnly,
      completedOnly,
      ordersCompleted: parsed.ordersCompleted,
      ...overrides,
    }),
    [
      completedOnly,
      countryValues,
      createdByValues,
      dateFrom,
      dateTo,
      minAmount,
      maxAmount,
      openOnly,
      orderNumDraft,
      parsed.ordersCompleted,
      payLoc,
      paymentTypeValues,
      phoneDraft,
      searchDraft,
      statusValues,
      week,
    ],
  );

  const pushFilters = useCallback(
    (overrides?: Partial<OrderFilters>, opts?: { refresh?: boolean }) => {
      const next = toOrderFilters(overrides);
      const base = buildOrdersListSearchParams(next, new URLSearchParams(searchParams.toString()));
      const qs = base.toString();
      router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders", { scroll: false });
      if (opts?.refresh) router.refresh();
    },
    [router, searchParams, toOrderFilters],
  );

  const schedulePush = useCallback(
    (overrides?: Partial<OrderFilters>, opts?: { refresh?: boolean }) => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = undefined;
        pushFilters(overrides, opts);
      }, 300);
    },
    [pushFilters],
  );

  const clearAllFilters = useCallback(() => {
    const base = clearOrdersFiltersSearchParams(new URLSearchParams(searchParams.toString()));
    const qs = base.toString();
    router.replace(qs ? `/admin/orders?${qs}` : "/admin/orders", { scroll: false });
    setAdvancedOpen(false);
    setMobileOpen(false);
  }, [router, searchParams]);

  const setRangeFromWeekCode = useCallback((code: string) => {
    const norm = normalizeAhWeekCode(code);
    if (!norm) return null;
    const r = getAhWeekRange(norm);
    if (!r) return null;
    setWeek(norm);
    setDateFrom(r.from);
    setDateTo(r.to);
    return { week: norm, dateFrom: r.from, dateTo: r.to };
  }, []);

  const onWeekCommitted = useCallback(
    (code: string) => {
      const norm = normalizeAhWeekCode(code);
      if (norm) {
        const range = setRangeFromWeekCode(norm);
        if (range) pushFilters(range, { refresh: true });
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
        normalizeAhWeekCode(input.ahWeekSelect) ||
        input.ahWeekSelect ||
        "AH-1";
      const n = parseAhWeekNumber(baseCode);
      if (n == null) return;
      const next = toAhWeekCode(delta === -1 ? goToPrevWeekNumber(n) : goToNextWeekNumber(n));
      const range = setRangeFromWeekCode(next);
      if (range) pushFilters(range, { refresh: true });
    },
    [input.ahWeekSelect, ordersWeekFromUrl, pushFilters, setRangeFromWeekCode, week],
  );

  const goToActiveWeek = useCallback(() => {
    const range = setRangeFromWeekCode(ACTIVE_WORK_WEEK_CODE);
    if (range) pushFilters(range, { refresh: true });
  }, [pushFilters, setRangeFromWeekCode]);

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

  const countryOptions = useMemo(
    () =>
      input.countryFilterOptions.map((o) => ({
        value: o.value,
        label: orderCountryLabelLocalized(o.value, uiLocale),
      })),
    [input.countryFilterOptions, uiLocale],
  );

  const createdByFilterOptions = useMemo(
    () => input.createdByOptions.map((o) => ({ value: o.id, label: o.label })),
    [input.createdByOptions],
  );

  const statusLabelByValue = useMemo(() => {
    const map = new Map(STATUS_OPTIONS.map((s) => [s.value, s.label]));
    return (value: string) => map.get(value) ?? value;
  }, [STATUS_OPTIONS]);

  const paymentLabelByValue = useMemo(() => {
    const map = new Map(paymentFilterOptions.map((p) => [p.value, p.label]));
    return (value: string) => map.get(value) ?? value;
  }, [paymentFilterOptions]);

  const weekRange = useMemo(() => {
    const code = normalizeAhWeekCode(week) ?? normalizeAhWeekCode(ordersWeekFromUrl) ?? "";
    return code ? getAhWeekRange(code) : null;
  }, [ordersWeekFromUrl, week]);

  const datesDifferFromWeek = useMemo(() => {
    if (!weekRange) return Boolean(dateFrom.trim() || dateTo.trim());
    return dateFrom !== weekRange.from || dateTo !== weekRange.to;
  }, [dateFrom, dateTo, weekRange]);

  const advancedFilterCount = useMemo(
    () =>
      countAdvancedFilters(
        toOrderFilters(),
        datesDifferFromWeek,
      ),
    [datesDifferFromWeek, toOrderFilters],
  );

  const activeFilterChips = useMemo((): ActiveFilterChip[] => {
    const chips: ActiveFilterChip[] = [];

    if (parsed.ordersCompleted === "done") {
      chips.push({
        key: "ordersCompleted",
        label: "הושלמו בלבד",
        onRemove: () => pushFilters({ ordersCompleted: "all" }),
      });
    } else if (parsed.ordersCompleted === "not_done") {
      chips.push({
        key: "ordersCompleted",
        label: "לא הושלמו",
        onRemove: () => pushFilters({ ordersCompleted: "all" }),
      });
    }

    if (searchDraft.trim()) {
      chips.push({
        key: "search",
        label: `חיפוש: ${searchDraft.trim()}`,
        onRemove: () => {
          setSearchDraft("");
          pushFilters({ search: "" });
        },
      });
    }

    if (!openOnly && !completedOnly && statusValues.length > 0) {
      chips.push({
        key: "status",
        label: `סטטוס: ${statusValues.map(statusLabelByValue).join(", ")}`,
        onRemove: () => {
          setStatusValues([]);
          pushFilters({ status: [] });
        },
      });
    }

    if (countryValues.length > 0) {
      chips.push({
        key: "country",
        label: `מדינה: ${countryValues.map((v) => orderCountryLabelLocalized(v, uiLocale)).join(", ")}`,
        onRemove: () => {
          setCountryValues([]);
          pushFilters({ country: [] });
        },
      });
    }

    if (paymentTypeValues.length > 0) {
      chips.push({
        key: "payment",
        label: `תשלום: ${paymentTypeValues.map(paymentLabelByValue).join(", ")}`,
        onRemove: () => {
          setPaymentTypeValues([]);
          pushFilters({ paymentMethod: [] });
        },
      });
    }

    if (datesDifferFromWeek && dateFrom && dateTo) {
      chips.push({
        key: "dates",
        label: `${formatYmdShort(dateFrom)}–${formatYmdShort(dateTo)}`,
        onRemove: () => {
          if (weekRange) {
            setDateFrom(weekRange.from);
            setDateTo(weekRange.to);
            pushFilters({ dateFrom: weekRange.from, dateTo: weekRange.to });
          } else {
            setDateFrom("");
            setDateTo("");
            pushFilters({ dateFrom: "", dateTo: "" });
          }
        },
      });
    }

    if (payLoc.trim()) {
      const payLabel =
        payLoc === "NONE"
          ? "ללא"
          : (input.paymentLocationOptions.find((p) => p.id === payLoc)?.label ?? payLoc);
      chips.push({
        key: "payLoc",
        label: `מקום תשלום: ${payLabel}`,
        onRemove: () => {
          setPayLoc("");
          pushFilters({ paymentLocation: "" });
        },
      });
    }

    if (createdByValues.length > 0) {
      chips.push({
        key: "createdBy",
        label: `עובד: ${createdByValues
          .map((id) => createdByFilterOptions.find((o) => o.value === id)?.label ?? id)
          .join(", ")}`,
        onRemove: () => {
          setCreatedByValues([]);
          pushFilters({ createdBy: [] });
        },
      });
    }

    if (minAmount.trim()) {
      chips.push({
        key: "minAmount",
        label: `מינימום: $${minAmount.trim()}`,
        onRemove: () => {
          setMinAmount("");
          pushFilters({ minAmountUsd: "" });
        },
      });
    }

    if (maxAmount.trim()) {
      chips.push({
        key: "maxAmount",
        label: `מקסימום: $${maxAmount.trim()}`,
        onRemove: () => {
          setMaxAmount("");
          pushFilters({ maxAmountUsd: "" });
        },
      });
    }

    if (orderNumDraft.trim()) {
      chips.push({
        key: "orderNum",
        label: `מספר הזמנה: ${orderNumDraft.trim()}`,
        onRemove: () => {
          setOrderNumDraft("");
          pushFilters({ orderNumber: "" });
        },
      });
    }

    if (phoneDraft.trim()) {
      chips.push({
        key: "phone",
        label: `טלפון: ${phoneDraft.trim()}`,
        onRemove: () => {
          setPhoneDraft("");
          pushFilters({ phone: "" });
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

    if (completedOnly) {
      chips.push({
        key: "completedOnly",
        label: "בוצע בלבד",
        onRemove: () => {
          setCompletedOnly(false);
          pushFilters({ completedOnly: false });
        },
      });
    }

    return chips;
  }, [
    completedOnly,
    countryValues,
    createdByFilterOptions,
    createdByValues,
    dateFrom,
    dateTo,
    datesDifferFromWeek,
    goToActiveWeek,
    input.ahWeekSelect,
    input.paymentLocationOptions,
    minAmount,
    maxAmount,
    openOnly,
    orderNumDraft,
    parsed.ordersCompleted,
    payLoc,
    paymentLabelByValue,
    paymentTypeValues,
    phoneDraft,
    pushFilters,
    searchDraft,
    statusLabelByValue,
    statusValues,
    uiLocale,
    week,
    weekRange,
    ordersWeekFromUrl,
  ]);

  const hasClearableFilters = activeFilterChips.length > 0;

  const mobileFilterCount = useMemo(() => {
    let count = advancedFilterCount;
    if (statusValues.length > 0 || openOnly || completedOnly) count++;
    if (countryValues.length > 0) count++;
    if (paymentTypeValues.length > 0) count++;
    if (searchDraft.trim()) count++;
    return count;
  }, [
    advancedFilterCount,
    completedOnly,
    countryValues.length,
    openOnly,
    paymentTypeValues.length,
    searchDraft,
    statusValues.length,
  ]);

  return {
    week,
    setWeek,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    searchDraft,
    setSearchDraft,
    orderNumDraft,
    setOrderNumDraft,
    phoneDraft,
    setPhoneDraft,
    statusValues,
    setStatusValues,
    countryValues,
    setCountryValues,
    createdByValues,
    setCreatedByValues,
    paymentTypeValues,
    setPaymentTypeValues,
    payLoc,
    setPayLoc,
    minAmount,
    setMinAmount,
    maxAmount,
    setMaxAmount,
    openOnly,
    setOpenOnly,
    completedOnly,
    setCompletedOnly,
    pushFilters,
    schedulePush,
    clearAllFilters,
    advancedOpen,
    setAdvancedOpen,
    mobileOpen,
    setMobileOpen,
    onWeekCommitted,
    shiftWeekNav,
    goToActiveWeek,
    weekRange,
    datesDifferFromWeek,
    advancedFilterCount,
    activeFilterChips,
    hasClearableFilters,
    mobileFilterCount,
    statusOptions: STATUS_OPTIONS,
    paymentFilterOptions,
    countryOptions,
    createdByFilterOptions,
    paymentLocationOptions: input.paymentLocationOptions,
    msStrings,
    msDir,
    getAhWeekCodeFromDateRange,
  };
}

export type UseOrdersListFiltersReturn = ReturnType<typeof useOrdersListFilters>;
