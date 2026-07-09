"use client";

import { CheckCircle2, Pencil } from "lucide-react";

export type CashCountStatusBarProps = {
  dayLabel: string;
  countSaved: boolean;
  countedAtHm: string | null;
  countedByName: string | null;
  onEdit: () => void;
};

/** תצוגה קומפקטית לאחר ספירת קופה — ללא שדות עריכה */
export function CashCountStatusBar({
  dayLabel,
  countSaved,
  countedAtHm,
  countedByName,
  onEdit,
}: CashCountStatusBarProps) {
  if (!countSaved) {
    return (
      <div className="cash-count-status cash-count-status--pending">
        <span className="cash-count-status__day">{dayLabel}</span>
        <span className="cash-count-status__msg">טרם בוצעה ספירת קופה ליום זה</span>
        <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={onEdit}>
          בצע ספירה
        </button>
      </div>
    );
  }

  return (
    <div className="cash-count-status cash-count-status--saved">
      <span className="cash-count-status__day">{dayLabel}</span>
      <span className="cash-count-status__ok">
        <CheckCircle2 size={15} aria-hidden />
        בוצעה ספירה
      </span>
      {countedAtHm ? (
        <span className="cash-count-status__meta">
          שעה <strong dir="ltr">{countedAtHm}</strong>
        </span>
      ) : null}
      {countedByName ? (
        <span className="cash-count-status__meta">
          מי ביצע <strong>{countedByName}</strong>
        </span>
      ) : null}
      <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={onEdit}>
        <Pencil size={13} aria-hidden /> ערוך ספירה
      </button>
    </div>
  );
}

export default CashCountStatusBar;
