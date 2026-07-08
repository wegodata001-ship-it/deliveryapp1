"use client";

import { useEffect, useState } from "react";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import { num } from "@/components/admin/cash-flow/shared";

export type TransfersSectionProps = {
  turkeyTransferUsd: string | null;
  editable: boolean;
  saving: boolean;
  onSave: (patch: { turkeyTransferUsd: string | null }) => void;
};

/**
 * אזור 7 — העברות לחו"ל.
 * כרגע: העברה לטורקיה ($). מבנה מוכן להוספת מדינות נוספות בעתיד.
 */
export function TransfersSection({ turkeyTransferUsd, editable, saving, onSave }: TransfersSectionProps) {
  const [usd, setUsd] = useState("");

  useEffect(() => {
    setUsd(turkeyTransferUsd ?? "");
  }, [turkeyTransferUsd]);

  const commit = () => onSave({ turkeyTransferUsd: usd.trim() || null });

  return (
    <section className="cc-block cc-block--transfer cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <span className="cc-block__dot cc-block__dot--purple" aria-hidden />
          העברות לחו"ל
        </div>
        <span className="cc-block__note">🌍 יעדים נוספים יתווספו בעתיד</span>
      </header>
      <div className="cc-count-form">
        <label className="cc-count-field">
          <span className="cc-count-field__lbl">🇹🇷 העברה לטורקיה ($)</span>
          {editable ? (
            <input
              type="text"
              inputMode="decimal"
              className="cc-input"
              value={usd}
              disabled={saving}
              placeholder="0"
              onChange={(e) => setUsd(e.target.value)}
              onBlur={commit}
            />
          ) : (
            <span className="cc-count-readonly">{fmtWeekFlowAmount("USD", num(turkeyTransferUsd))}</span>
          )}
        </label>
      </div>
    </section>
  );
}

export default TransfersSection;
