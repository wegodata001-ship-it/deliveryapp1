/**
 * Source of truth — סינון רשימת הזמנות (URL ↔ state).
 * שבוע הרשימה = ordersWeek. week=/from=/to= הם שיקוף לכרום בלבד.
 */

import { readMultiParam, setMultiParam } from "@/lib/orders-list-filter-params";
import { OS } from "@/lib/order-status-slugs";
import {
  getAhWeekRange,
  isCustomOrdersDateRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";
import { resolveOrdersListCustomerQuery } from "@/app/admin/orders/orders-list-where";
import {
  ORDERS_KPI_PARAM,
  parseOrdersKpiFilters,
  serializeOrdersKpiFilters,
  type OrdersKpiFilterKey,
} from "@/lib/orders-status-kpi-filter";

export type OrdersCompletedFilter = "all" | "done" | "not_done";

export type OrderFilters = {
  week: string;
  dateFrom: string;
  dateTo: string;
  search: string;
  country: string[];
  paymentMethod: string[];
  /** unpaid | partial | paid | overpaid */
  paymentStatus: string[];
  status: string[];
  orderNumber: string;
  phone: string;
  paymentLocation: string;
  createdBy: string[];
  minAmountUsd: string;
  maxAmountUsd: string;
  openOnly: boolean;
  completedOnly: boolean;
  ordersCompleted: OrdersCompletedFilter;
  /** ריבועי KPI — נפרד מ-status= של מסנן «סטטוס הזמנה» */
  kpiStatuses: OrdersKpiFilterKey[];
};

export const ORDERS_FILTER_URL_KEYS = [
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
  "paymentStatus",
  "paymentLocation",
  "amountMin",
  "amountMax",
  "ordersOpenOnly",
  "ordersReadyOnly",
  "ordersCompleted",
  "ordersKpi",
  "page",
] as const;

const GLOBAL_PRESERVE_KEYS = ["week", "from", "to", "country"] as const;
const WEEK_PRESERVE_KEYS = ["ordersWeek", "ordersFrom", "ordersTo"] as const;

function readTextParam(sp: Record<string, string | string[] | undefined>, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v.trim() : "";
}

export function parseOrderFiltersFromSearchParams(
  sp: Record<string, string | string[] | undefined>,
  defaults: { week: string; dateFrom: string; dateTo: string },
): OrderFilters {
  const weekRaw = readTextParam(sp, "ordersWeek");
  const dateFrom = readTextParam(sp, "ordersFrom") || readTextParam(sp, "from") || defaults.dateFrom;
  const dateTo = readTextParam(sp, "ordersTo") || readTextParam(sp, "to") || defaults.dateTo;
  const week = isCustomOrdersDateRange(weekRaw, dateFrom, dateTo)
    ? ""
    : (normalizeAhWeekCode(weekRaw) ?? weekRaw) || defaults.week;

  const completedRaw = readTextParam(sp, "ordersCompleted");
  const ordersCompleted: OrdersCompletedFilter =
    completedRaw === "done" || completedRaw === "not_done" ? completedRaw : "all";

  return {
    week,
    dateFrom,
    dateTo,
    search: resolveOrdersListCustomerQuery(sp),
    country: readMultiParam(sp, "ordersCountry"),
    paymentMethod: readMultiParam(sp, "paymentType"),
    paymentStatus: readMultiParam(sp, "paymentStatus").filter((v) =>
      ["unpaid", "partial", "paid", "overpaid"].includes(v),
    ),
    status: readMultiParam(sp, "status"),
    orderNumber: readTextParam(sp, "ordersOrderNum"),
    phone: readTextParam(sp, "ordersPhone"),
    paymentLocation: readTextParam(sp, "paymentLocation"),
    createdBy: readMultiParam(sp, "createdBy"),
    minAmountUsd: readTextParam(sp, "amountMin"),
    maxAmountUsd: readTextParam(sp, "amountMax"),
    openOnly: readTextParam(sp, "ordersOpenOnly") === "1",
    completedOnly: readTextParam(sp, "ordersReadyOnly") === "1",
    ordersCompleted,
    kpiStatuses: parseOrdersKpiFilters(sp),
  };
}

export function buildOrdersListSearchParams(
  filters: OrderFilters,
  existing: URLSearchParams,
  opts?: { preserveGlobal?: boolean },
): URLSearchParams {
  const base = new URLSearchParams();

  if (opts?.preserveGlobal !== false) {
    for (const k of GLOBAL_PRESERVE_KEYS) {
      const v = existing.get(k);
      if (v) base.set(k, v);
    }
  }

  for (const k of ORDERS_FILTER_URL_KEYS) base.delete(k);

  const week = filters.week.trim();
  const dateFrom = filters.dateFrom.trim();
  const dateTo = filters.dateTo.trim();
  const weekRange = week ? getAhWeekRange(week) : null;
  const dateRangeMode = isCustomOrdersDateRange(week, dateFrom, dateTo);

  if (weekRange && !dateRangeMode) {
    const fromYmd = (dateFrom || weekRange.from).slice(0, 10);
    const toYmd = (dateTo || weekRange.to).slice(0, 10);
    base.set("ordersWeek", week);
    base.set("ordersFrom", fromYmd);
    base.set("ordersTo", toYmd);
    base.set("week", week);
    base.set("from", fromYmd);
    base.set("to", toYmd);
  } else if (dateFrom || dateTo) {
    if (dateFrom) {
      base.set("ordersFrom", dateFrom);
      base.set("from", dateFrom);
    }
    if (dateTo) {
      base.set("ordersTo", dateTo);
      base.set("to", dateTo);
    }
    base.delete("ordersWeek");
    base.set("ordersPreset", "range");
  }

  if (filters.search.trim()) base.set("ordersCustomer", filters.search.trim());
  if (filters.orderNumber.trim()) base.set("ordersOrderNum", filters.orderNumber.trim());
  if (filters.phone.trim()) base.set("ordersPhone", filters.phone.trim());

  if (filters.openOnly) {
    base.set("ordersOpenOnly", "1");
    setMultiParam(base, "status", [OS.OPEN]);
  } else if (filters.completedOnly) {
    base.set("ordersReadyOnly", "1");
    setMultiParam(base, "status", [OS.COMPLETED]);
  } else {
    setMultiParam(base, "status", filters.status);
  }

  setMultiParam(base, "ordersCountry", filters.country);
  setMultiParam(base, "createdBy", filters.createdBy);
  setMultiParam(base, "paymentType", filters.paymentMethod);
  setMultiParam(base, "paymentStatus", filters.paymentStatus);

  if (filters.paymentLocation.trim()) base.set("paymentLocation", filters.paymentLocation.trim());
  if (filters.minAmountUsd.trim()) base.set("amountMin", filters.minAmountUsd.trim());
  if (filters.maxAmountUsd.trim()) base.set("amountMax", filters.maxAmountUsd.trim());

  if (filters.ordersCompleted === "done") base.set("ordersCompleted", "done");
  else if (filters.ordersCompleted === "not_done") base.set("ordersCompleted", "not_done");

  const kpi = serializeOrdersKpiFilters(filters.kpiStatuses ?? []);
  if (kpi) base.set(ORDERS_KPI_PARAM, kpi);
  else base.delete(ORDERS_KPI_PARAM);

  base.delete("page");
  return base;
}

export function clearOrdersFiltersSearchParams(existing: URLSearchParams): URLSearchParams {
  const base = new URLSearchParams();
  const country = existing.get("country");
  if (country) base.set("country", country);

  const weekRaw = existing.get("ordersWeek") || existing.get("week") || "";
  const week = normalizeAhWeekCode(weekRaw) ?? weekRaw;
  const from = existing.get("ordersFrom") || existing.get("from") || "";
  const to = existing.get("ordersTo") || existing.get("to") || "";
  const customRange = isCustomOrdersDateRange(weekRaw, from, to);
  const range = week ? getAhWeekRange(week) : null;

  if (range && !customRange) {
    for (const k of WEEK_PRESERVE_KEYS) {
      const v = existing.get(k);
      if (v) base.set(k, v);
    }
    for (const k of GLOBAL_PRESERVE_KEYS) {
      if (k === "country") continue;
      const v = existing.get(k);
      if (v) base.set(k, v);
    }
    return base;
  }

  if (range) {
    base.set("ordersWeek", week);
    base.set("ordersFrom", range.from);
    base.set("ordersTo", range.to);
    base.set("week", week);
    base.set("from", range.from);
    base.set("to", range.to);
    return base;
  }

  for (const k of GLOBAL_PRESERVE_KEYS) {
    if (k === "country") continue;
    const v = existing.get(k);
    if (v) base.set(k, v);
  }
  return base;
}

export function countAdvancedFilters(
  filters: OrderFilters,
  datesDifferFromWeek: boolean,
): number {
  let n = 0;
  if (filters.phone.trim()) n++;
  if (filters.paymentLocation.trim()) n++;
  if (filters.createdBy.length > 0) n++;
  if (filters.minAmountUsd.trim()) n++;
  if (filters.maxAmountUsd.trim()) n++;
  if (filters.orderNumber.trim()) n++;
  if (filters.country.length > 0) n++;
  if (filters.openOnly) n++;
  if (filters.completedOnly) n++;
  if (datesDifferFromWeek) n++;
  return n;
}
