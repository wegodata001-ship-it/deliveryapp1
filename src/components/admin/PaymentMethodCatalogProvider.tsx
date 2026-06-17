"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getPaymentMethodCatalogAction, type PaymentMethodCatalog } from "@/app/admin/payment-method/actions";
import type { PaymentMethodSelectOption, PaymentMethodTag } from "@/lib/payment-method-shared";
import { paymentMethodOptionsIncludingValue } from "@/lib/payment-method-shared";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments-source-shared";
import { LEGACY_PAYMENT_METHOD_SLUGS } from "@/lib/payment-method-slugs";

type PaymentMethodCatalogContextValue = {
  catalog: PaymentMethodCatalog;
  loading: boolean;
  refresh: () => void;
  getLabel: (methodId: string) => string;
  getColorHex: (methodId: string) => string | undefined;
  labelById: Record<string, string>;
  options: PaymentMethodSelectOption[];
  methods: PaymentMethodTag[];
  optionsForValue: (currentValue?: string) => PaymentMethodSelectOption[];
};

const FALLBACK_METHODS: PaymentMethodTag[] = LEGACY_PAYMENT_METHOD_SLUGS.map((id, idx) => ({
  id,
  nameHe: PAYMENT_METHOD_LABELS[id] ?? id,
  nameAr: null,
  nameEn: null,
  colorHex: "#64748b",
  icon: null,
  isActive: true,
  sortOrder: idx * 10,
}));

const FALLBACK_OPTIONS: PaymentMethodSelectOption[] = FALLBACK_METHODS.filter((m) =>
  ["CASH", "BANK_TRANSFER", "CHECK", "CREDIT", "OTHER"].includes(m.id),
).map((m) => ({ value: m.id, label: m.nameHe, colorHex: m.colorHex }));

const FALLBACK_LABELS = Object.fromEntries(FALLBACK_METHODS.map((m) => [m.id, m.nameHe]));

const EMPTY: PaymentMethodCatalog = {
  methods: FALLBACK_METHODS,
  labelById: FALLBACK_LABELS,
  options: FALLBACK_OPTIONS,
  quickOptions: FALLBACK_OPTIONS,
};

const Ctx = createContext<PaymentMethodCatalogContextValue | null>(null);

function methodColorById(methods: PaymentMethodTag[], id: string): string | undefined {
  return methods.find((m) => m.id === id)?.colorHex;
}

export function PaymentMethodCatalogProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<PaymentMethodCatalog>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    void getPaymentMethodCatalogAction()
      .then((next) => setCatalog(next.options.length > 0 ? next : EMPTY))
      .catch(() => setCatalog(EMPTY))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const value = useMemo<PaymentMethodCatalogContextValue>(() => {
    const getLabel = (methodId: string) => catalog.labelById[methodId] ?? PAYMENT_METHOD_LABELS[methodId] ?? "אמצעי לא ידוע";
    const getColorHex = (methodId: string) => methodColorById(catalog.methods, methodId);
    const optionsForValue = (currentValue?: string) =>
      paymentMethodOptionsIncludingValue(catalog.options, catalog.labelById, currentValue);

    return {
      catalog,
      loading,
      refresh: load,
      getLabel,
      getColorHex,
      labelById: catalog.labelById,
      options: catalog.options,
      methods: catalog.methods,
      optionsForValue,
    };
  }, [catalog, loading, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePaymentMethodCatalog(): PaymentMethodCatalogContextValue {
  const v = useContext(Ctx);
  if (!v) {
    return {
      catalog: EMPTY,
      loading: false,
      refresh: () => {},
      getLabel: (id) => PAYMENT_METHOD_LABELS[id] ?? id,
      getColorHex: () => undefined,
      labelById: FALLBACK_LABELS,
      options: FALLBACK_OPTIONS,
      methods: FALLBACK_METHODS,
      optionsForValue: () => FALLBACK_OPTIONS,
    };
  }
  return v;
}
