"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  WEGO_FINANCIAL_SETTINGS_SAVED,
  type FinancialSettingsSavedDetail,
} from "@/lib/financial-settings-bus";
import { displayDollarRateNumber } from "@/lib/display-dollar-rate";
import type { SerializedFinancial } from "@/lib/financial-settings.shared";

const DisplayExchangeRateContext = createContext(0);

export function DisplayExchangeRateProvider({
  financial,
  children,
}: {
  financial: SerializedFinancial | null;
  children: ReactNode;
}) {
  const [live, setLive] = useState(financial);

  useEffect(() => {
    setLive(financial);
  }, [financial]);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<FinancialSettingsSavedDetail>).detail;
      if (detail) setLive(detail);
    };
    window.addEventListener(WEGO_FINANCIAL_SETTINGS_SAVED, onSaved);
    return () => window.removeEventListener(WEGO_FINANCIAL_SETTINGS_SAVED, onSaved);
  }, []);

  const rate = useMemo(() => displayDollarRateNumber(live), [live]);

  return <DisplayExchangeRateContext.Provider value={rate}>{children}</DisplayExchangeRateContext.Provider>;
}

/** Active display FX rate from FinancialSettings SSOT (finalDollarRate). */
export function useDisplayExchangeRate(): number {
  return useContext(DisplayExchangeRateContext);
}
