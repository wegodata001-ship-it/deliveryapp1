"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  getOrderStatusCatalogAction,
  type OrderStatusCatalog,
} from "@/app/admin/order-status/actions";
import {
  ORDER_STATUS_EDIT_SELECT_OPTIONS,
  ORDER_STATUS_QUICK_SELECT_OPTIONS,
  getOrderStatusLabel,
} from "@/constants/order-status";

type OrderStatusCatalogContextValue = {
  catalog: OrderStatusCatalog;
  loading: boolean;
  refresh: () => void;
  getLabel: (status: string) => string;
  quickOptions: Array<{ value: string; label: string }>;
  editOptions: Array<{ value: string; label: string }>;
};

const FALLBACK: OrderStatusCatalog = {
  labelById: Object.fromEntries(
    ORDER_STATUS_EDIT_SELECT_OPTIONS.map((o) => [o.value, o.label]),
  ),
  quickOptions: ORDER_STATUS_QUICK_SELECT_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  })),
  editOptions: ORDER_STATUS_EDIT_SELECT_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  })),
};

const Ctx = createContext<OrderStatusCatalogContextValue | null>(null);

export function OrderStatusCatalogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [catalog, setCatalog] = useState<OrderStatusCatalog>(FALLBACK);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    void getOrderStatusCatalogAction()
      .then((next) => setCatalog(next))
      .catch(() => setCatalog(FALLBACK))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load, pathname]);

  const value = useMemo<OrderStatusCatalogContextValue>(() => {
    const getLabel = (status: string) =>
      catalog.labelById[status] ?? getOrderStatusLabel(status);

    return {
      catalog,
      loading,
      refresh: load,
      getLabel,
      quickOptions: catalog.quickOptions,
      editOptions: catalog.editOptions,
    };
  }, [catalog, loading, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrderStatusCatalog(): OrderStatusCatalogContextValue {
  const v = useContext(Ctx);
  if (!v) {
    return {
      catalog: FALLBACK,
      loading: false,
      refresh: () => {},
      getLabel: getOrderStatusLabel,
      quickOptions: ORDER_STATUS_QUICK_SELECT_OPTIONS,
      editOptions: ORDER_STATUS_EDIT_SELECT_OPTIONS,
    };
  }
  return v;
}
