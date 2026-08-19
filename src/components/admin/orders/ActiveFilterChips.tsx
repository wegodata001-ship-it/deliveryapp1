"use client";

import { X } from "lucide-react";
import type { ActiveFilterChip } from "./useOrdersListFilters";

type Props = {
  activeFilterChips: ActiveFilterChip[];
  clearAllFilters: () => void;
  hasClearableFilters: boolean;
};

export function ActiveFilterChips({ activeFilterChips, clearAllFilters, hasClearableFilters }: Props) {
  if (activeFilterChips.length === 0) return null;

  return (
    <div className="ofb-chips" dir="rtl" aria-label="סינונים פעילים">
      {activeFilterChips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="ofb-chips__chip"
          onClick={chip.onRemove}
          title="הסר סינון"
        >
          <span>{chip.label}</span>
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      ))}
      {hasClearableFilters ? (
        <button type="button" className="ofb-chips__clear" onClick={clearAllFilters}>
          נקה הכל
        </button>
      ) : null}
    </div>
  );
}
