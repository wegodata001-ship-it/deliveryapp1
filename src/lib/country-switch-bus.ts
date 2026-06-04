"use client";

import type { WorkCountryCode } from "@/lib/work-country";

export const WEGO_COUNTRY_CHANGED = "wego:country-changed";

export type CountryChangedDetail = {
  workCountry: WorkCountryCode;
};

export function dispatchCountryChanged(workCountry: WorkCountryCode): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CountryChangedDetail>(WEGO_COUNTRY_CHANGED, { detail: { workCountry } }),
  );
}
