"use client";

import { AdminWeekPicker } from "@/components/admin/AdminWeekPicker";

type Props = {
  weekCode: string;
  disabled?: boolean;
  loading?: boolean;
  onWeekChange: (normalizedWeek: string) => void;
  onShift: (delta: -1 | 1) => void;
};

/**
 * בחירת שבוע ברשימת הזמנות — overlay קומפקטי, חיפוש מקומי בלבד.
 */
export function OrdersWeekPicker({ weekCode, disabled, loading, onWeekChange, onShift }: Props) {
  return (
    <AdminWeekPicker
      className="ofb-week-picker"
      chipClassName="ofb-week-picker__chip"
      arrowClassName="ofb__week-btn"
      showLabel
      weekCode={weekCode}
      disabled={disabled}
      loading={loading}
      onWeekChange={(normalizedWeek) => onWeekChange(normalizedWeek)}
      onShift={onShift}
    />
  );
}
