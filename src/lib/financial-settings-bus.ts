import type { SerializedFinancial } from "@/lib/financial-settings";

export const WEGO_FINANCIAL_SETTINGS_SAVED = "wego:financial-settings-saved";

export type FinancialSettingsSavedDetail = SerializedFinancial;

/** מפיץ עדכון הגדרות כספים לכל המסכים הפתוחים (ללא רענון דף) */
export function dispatchFinancialSettingsSaved(settings: SerializedFinancial): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<FinancialSettingsSavedDetail>(WEGO_FINANCIAL_SETTINGS_SAVED, { detail: settings }),
  );
}

/** מעדכן state במסכי קליטה כשהגדרות כספים נשמרו */
export function applyFinancialSettingsToCaptureUi(
  data: SerializedFinancial,
  opts: {
    isEdit: boolean;
    finalRateTouched: boolean;
    commissionTouched: boolean;
    setFinanceLive: (v: SerializedFinancial) => void;
    setFinalRateStr: (v: string) => void;
    setCommissionPercentStr: (v: string) => void;
    formatCommission: (f: SerializedFinancial | null) => string;
  },
): void {
  opts.setFinanceLive(data);
  if (!opts.isEdit && !opts.finalRateTouched) {
    const f = Number(String(data.finalDollarRate).replace(",", "."));
    if (Number.isFinite(f) && f > 0) opts.setFinalRateStr(f.toFixed(4));
  }
  if (!opts.isEdit && !opts.commissionTouched) {
    opts.setCommissionPercentStr(opts.formatCommission(data));
  }
}
