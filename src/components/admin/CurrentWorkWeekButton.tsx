"use client";

import { Home } from "lucide-react";
import { isActiveWorkWeekCode } from "@/lib/active-work-week";

type Props = {
  disabled?: boolean;
  /** שבוע מוצג כרגע — לכיבוי הכפתור כשכבר בשבוע הפעיל */
  weekCode?: string | null;
  onClick: () => void;
  className?: string;
};

/** מחזיר תצוגת שבוע לשבוע העבודה הפעיל — לא משנה נתונים עסקיים */
export function CurrentWorkWeekButton({ disabled, weekCode, onClick, className }: Props) {
  const isCurrent = isActiveWorkWeekCode(weekCode);

  return (
    <button
      type="button"
      className={["adm-report-week-nav__current", className].filter(Boolean).join(" ")}
      disabled={disabled || isCurrent}
      aria-label={isCurrent ? "כבר בשבוע העבודה הנוכחי" : "חזרה לשבוע העבודה הנוכחי"}
      title={isCurrent ? "שבוע עבודה נוכחי" : "שבוע נוכחי"}
      onClick={onClick}
    >
      <Home size={14} strokeWidth={2.35} aria-hidden className="adm-report-week-nav__current-icon" />
      <span>שבוע נוכחי</span>
    </button>
  );
}
