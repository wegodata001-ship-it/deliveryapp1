"use client";

import { Pencil } from "lucide-react";
import { CASH_DAILY_METHODS, type CashDailyMethodId } from "@/lib/cash-control-daily";
import { MethodIcon } from "@/components/admin/cash-flow/shared";

export type CashCountSectionProps = {
  valueOf: (method: CashDailyMethodId) => string;
  readOnlyValueOf: (method: CashDailyMethodId) => string;
  editable: boolean;
  saving: boolean;
  onChange: (method: CashDailyMethodId, value: string) => void;
  onBlurSave: (method: CashDailyMethodId, value: string) => void;
};

/** ספירת קופה — נתונים ידניים */
export function CashCountSection({
  valueOf,
  readOnlyValueOf,
  editable,
  saving,
  onChange,
  onBlurSave,
}: CashCountSectionProps) {
  return (
    <section className="cc-block cc-block--manual cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <span className="cc-block__dot cc-block__dot--green" aria-hidden />
          ספירת קופה
        </div>
        <span className="cc-block__note cc-block__note--edit">
          <Pencil size={12} aria-hidden /> נתונים ידניים — נשמרים אוטומטית
        </span>
      </header>
      <div className="cc-count-form">
        {CASH_DAILY_METHODS.map((m) => (
          <label key={m.id} className="cc-count-field">
            <span className="cc-count-field__lbl">
              <MethodIcon method={m.id} size={14} /> {m.label}
            </span>
            {editable ? (
              <input
                type="text"
                inputMode="decimal"
                className="cc-input"
                value={valueOf(m.id)}
                disabled={saving}
                placeholder="0"
                onChange={(e) => onChange(m.id, e.target.value)}
                onBlur={(e) => onBlurSave(m.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            ) : (
              <span className="cc-count-readonly">{readOnlyValueOf(m.id) || "—"}</span>
            )}
          </label>
        ))}
      </div>
    </section>
  );
}

export default CashCountSection;
