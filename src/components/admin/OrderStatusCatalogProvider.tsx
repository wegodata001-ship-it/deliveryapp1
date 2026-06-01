"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getOrderStatusCatalogAction,
  type OrderStatusCatalog,
} from "@/app/admin/order-status/actions";
import type { OrderStatusSelectOption, OrderStatusTag } from "@/lib/order-status-shared";
import { statusColorById, statusOptionsIncludingValue } from "@/lib/order-status-catalog";

type OrderStatusCatalogContextValue = {
  catalog: OrderStatusCatalog;
  loading: boolean;
  refresh: () => void;
  getLabel: (statusId: string) => string;
  getColorHex: (statusId: string) => string | undefined;
  /** כל הסטטוסים הפעילים — מקור יחיד */
  options: OrderStatusSelectOption[];
  statuses: OrderStatusTag[];
  optionsForValue: (currentValue?: string) => OrderStatusSelectOption[];
  /** @deprecated use options */
  quickOptions: OrderStatusSelectOption[];
  /** @deprecated use options */
  editOptions: OrderStatusSelectOption[];
};

const EMPTY: OrderStatusCatalog = {
  statuses: [],
  labelById: {},
  options: [],
  quickOptions: [],
  editOptions: [],
};

const Ctx = createContext<OrderStatusCatalogContextValue | null>(null);

export function OrderStatusCatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<OrderStatusCatalog>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    void getOrderStatusCatalogAction()
      .then((next) => setCatalog(next))
      .catch(() => setCatalog(EMPTY))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const value = useMemo<OrderStatusCatalogContextValue>(() => {
    const getLabel = (statusId: string) => catalog.labelById[statusId] ?? "סטטוס לא ידוע";
    const getColorHex = (statusId: string) => statusColorById(catalog.statuses, statusId);
    const optionsForValue = (currentValue?: string) =>
      statusOptionsIncludingValue(catalog.options, catalog.labelById, currentValue);

    return {
      catalog,
      loading,
      refresh: load,
      getLabel,
      getColorHex,
      options: catalog.options,
      statuses: catalog.statuses,
      optionsForValue,
      quickOptions: catalog.options,
      editOptions: catalog.options,
    };
  }, [catalog, loading, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrderStatusCatalog(): OrderStatusCatalogContextValue {
  const v = useContext(Ctx);
  if (!v) {
    return {
      catalog: EMPTY,
      loading: false,
      refresh: () => {},
      getLabel: (id) => id,
      getColorHex: () => undefined,
      options: [],
      statuses: [],
      optionsForValue: () => [],
      quickOptions: [],
      editOptions: [],
    };
  }
  return v;
}
