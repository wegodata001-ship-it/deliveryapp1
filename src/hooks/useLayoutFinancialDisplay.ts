"use client";

import { useEffect, useMemo, useState } from "react";
import type { SerializedFinancial } from "@/lib/financial-settings";
import {
  WEGO_FINANCIAL_SETTINGS_SAVED,
  type FinancialSettingsSavedDetail,
} from "@/lib/financial-settings-bus";
import { displayDollarRate, displayDollarRateTitle } from "@/lib/display-dollar-rate";

/** שער דולר לתצוגה ב-header — מסנכרן עם prop מהשרת ועם שמירת הגדרות כספים (ללא fetch) */
export function useLayoutFinancialDisplay(serverFinancial: SerializedFinancial | null) {
  const [financial, setFinancial] = useState(serverFinancial);

  useEffect(() => {
    setFinancial(serverFinancial);
  }, [serverFinancial]);

  useEffect(() => {
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<FinancialSettingsSavedDetail>).detail;
      if (detail) setFinancial(detail);
    };
    window.addEventListener(WEGO_FINANCIAL_SETTINGS_SAVED, onSaved);
    return () => window.removeEventListener(WEGO_FINANCIAL_SETTINGS_SAVED, onSaved);
  }, []);

  return useMemo(
    () => ({
      rateLabel: displayDollarRate(financial),
      rateTitle: displayDollarRateTitle(financial),
    }),
    [financial],
  );
}
