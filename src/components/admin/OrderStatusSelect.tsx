"use client";

import { useMemo } from "react";
import { useOrderStatusCatalog } from "@/components/admin/OrderStatusCatalogProvider";
import { statusSelectBorderStyle } from "@/lib/order-status-catalog";

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
}: Props) {
  const { options, optionsForValue, getColorHex, loading } = useOrderStatusCatalog();

  const list = useMemo(
    () => (includeCurrentValue ? optionsForValue(value) : options),
    [includeCurrentValue, options, optionsForValue, value],
  );

  const colorHex = getColorHex(value);
  const variantClass = variant === "table" ? "adm-order-status-select--table" : "adm-order-status-select--default";

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
            {o.colorHex ? `● ${o.label}` : o.label}
          </option>
        ))
      )}
    </select>
  );
}
