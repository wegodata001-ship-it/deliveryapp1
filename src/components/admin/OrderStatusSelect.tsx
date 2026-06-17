"use client";

import { useMemo } from "react";
import { useOrderStatusCatalog } from "@/components/admin/OrderStatusCatalogProvider";
import { statusColorById, statusSelectBorderStyle } from "@/lib/order-status-catalog";
import { officialStatusOptionsForValue } from "@/lib/order-status-shared";
import { getOfficialOrderStatusDisplayLabel } from "@/constants/order-status";

type Props = {
  id?: string;
  value: string;
  onChange: (statusId: string) => void;
  disabled?: boolean;
  className?: string;
  /** כולל ערך נוכחי גם אם כבוי בטבלה */
  includeCurrentValue?: boolean;
  "aria-label"?: string;
  variant?: "default" | "table";
  /** ברשימת הזמנות — רק 5 סטטוסים רשמיים */
  officialOnly?: boolean;
};

export function OrderStatusSelect({
  id,
  value,
  onChange,
  disabled,
  className = "",
  includeCurrentValue = true,
  "aria-label": ariaLabel = "סטטוס הזמנה",
  variant = "default",
  officialOnly = false,
}: Props) {
  const { options, optionsForValue, labelById, getColorHex, loading } = useOrderStatusCatalog();

  const list = useMemo(() => {
    if (officialOnly || variant === "table") {
      return officialStatusOptionsForValue(options, labelById, includeCurrentValue ? value : undefined);
    }
    return includeCurrentValue ? optionsForValue(value) : options;
  }, [officialOnly, variant, includeCurrentValue, options, optionsForValue, labelById, value]);

  const colorHex = getColorHex(value);
  const variantClass = variant === "table" ? "adm-order-status-select--table" : "adm-order-status-select--default";
  const displayLabel = (statusId: string, label: string): string =>
    getOfficialOrderStatusDisplayLabel(statusId) || label;

  return (
    <select
      id={id}
      className={`adm-order-status-select ${variantClass} ${className}`.trim()}
      value={value}
      disabled={disabled || loading || list.length === 0}
      aria-label={ariaLabel}
      style={statusSelectBorderStyle(colorHex)}
      onChange={(e) => onChange(e.target.value)}
    >
      {list.length === 0 ? (
        <option value={value}>{loading ? "טוען…" : "אין סטטוסים"}</option>
      ) : (
        list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.colorHex ? `● ${displayLabel(o.value, o.label)}` : displayLabel(o.value, o.label)}
          </option>
        ))
      )}
    </select>
  );
}
