/**
 * Source of truth — סינון רשימת הזמנות (URL ↔ state).
 */

import { readMultiParam, setMultiParam } from "@/lib/orders-list-filter-params";
import { OS } from "@/lib/order-status-slugs";
import {
  getAhWeekRange,
  normalizeAhWeekCode,
} from "@/lib/work-week";
import { resolveOrdersListCustomerQuery } from "@/app/admin/orders/orders-list-where";

export type OrdersCompletedFilter = "all" | "done" | "not_done";

export type OrderFilters = {
  week: string;
  dateFrom: string;
  dateTo: string;
  search: string;
  country: string[];
  paymentMethod: string[];
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
  "paymentLocation",
  "amountMin",
  "amountMax",
  "ordersOpenOnly",
  "ordersReadyOnly",
  "ordersCompleted",
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
  const week = (normalizeAhWeekCode(weekRaw) ?? weekRaw) || defaults.week;

  const completedRaw = readTextParam(sp, "ordersCompleted");
  const ordersCompleted: OrdersCompletedFilter =
    completedRaw === "done" || completedRaw === "not_done" ? completedRaw : "all";

  return {
    week,
    dateFrom: readTextParam(sp, "ordersFrom") || defaults.dateFrom,
    dateTo: readTextParam(sp, "ordersTo") || defaults.dateTo,
    search: resolveOrdersListCustomerQuery(sp),
    country: readMultiParam(sp, "ordersCountry"),
    paymentMethod: readMultiParam(sp, "paymentType"),
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
  if (week && getAhWeekRange(week)) {
    const r = getAhWeekRange(week)!;
    base.set("ordersWeek", week);
    base.set("ordersFrom", (filters.dateFrom.trim() || r.from).slice(0, 10));
    base.set("ordersTo", (filters.dateTo.trim() || r.to).slice(0, 10));
  } else {
    if (filters.dateFrom.trim()) base.set("ordersFrom", filters.dateFrom.trim());
    if (filters.dateTo.trim()) base.set("ordersTo", filters.dateTo.trim());
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

  if (filters.paymentLocation.trim()) base.set("paymentLocation", filters.paymentLocation.trim());
  if (filters.minAmountUsd.trim()) base.set("amountMin", filters.minAmountUsd.trim());
  if (filters.maxAmountUsd.trim()) base.set("amountMax", filters.maxAmountUsd.trim());

  if (filters.ordersCompleted === "done") base.set("ordersCompleted", "done");
  else if (filters.ordersCompleted === "not_done") base.set("ordersCompleted", "not_done");

  base.delete("page");
  return base;
}

export function clearOrdersFiltersSearchParams(existing: URLSearchParams): URLSearchParams {
  const base = new URLSearchParams();
  for (const k of GLOBAL_PRESERVE_KEYS) {
    const v = existing.get(k);
    if (v) base.set(k, v);
  }
  for (const k of WEEK_PRESERVE_KEYS) {
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
  if (filters.openOnly) n++;
  if (filters.completedOnly) n++;
  if (datesDifferFromWeek) n++;
  return n;
}
