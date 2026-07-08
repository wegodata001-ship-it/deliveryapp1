"use client";

import { useEffect, useState } from "react";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import { num } from "@/components/admin/cash-flow/shared";

export type BalancesSectionProps = {
  bankBalanceIls: string | null;
  bankBalanceUsd: string | null;
  drawerRemainingIls: string;
  drawerRemainingUsd: string;
  editable: boolean;
  saving: boolean;
  onSaveBank: (patch: { bankBalanceIls: string | null; bankBalanceUsd: string | null }) => void;
};

/** אזור 8 — יתרות: בנק (₪/$) + יתרה שנשארה בקופה (₪/$) */
export function BalancesSection({
  bankBalanceIls,
  bankBalanceUsd,
  drawerRemainingIls,
  drawerRemainingUsd,
  editable,
  saving,
  onSaveBank,
}: BalancesSectionProps) {
  const [ils, setIls] = useState("");
  const [usd, setUsd] = useState("");

  useEffect(() => {
    setIls(bankBalanceIls ?? "");
    setUsd(bankBalanceUsd ?? "");
  }, [bankBalanceIls, bankBalanceUsd]);

  const commit = () => onSaveBank({ bankBalanceIls: ils.trim() || null, bankBalanceUsd: usd.trim() || null });

  return (
    <section className="cc-block cc-block--balances cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <span className="cc-block__dot cc-block__dot--slate" aria-hidden />
          יתרות
        </div>
        <span className="cc-block__note">🏦 בנק · 💰 קופה</span>
      </header>

      <div className="cc-balances-grid">
        <div className="cc-balance-group">
          <h4 className="cc-balance-group__title">יתרה בבנק</h4>
          <div className="cc-count-form">
            <label className="cc-count-field">
              <span className="cc-count-field__lbl">₪ שקל</span>
              {editable ? (
                <input
                  type="text"
                  inputMode="decimal"
                  className="cc-input"
                  value={ils}
                  disabled={saving}
                  placeholder="0"
                  onChange={(e) => setIls(e.target.value)}
                  onBlur={commit}
                />
              ) : (
                <span className="cc-count-readonly">{fmtWeekFlowAmount("ILS", num(bankBalanceIls))}</span>
              )}
            </label>
            <label className="cc-count-field">
              <span className="cc-count-field__lbl">$ דולר</span>
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
                <span className="cc-count-readonly">{fmtWeekFlowAmount("USD", num(bankBalanceUsd))}</span>
              )}
            </label>
          </div>
        </div>

        <div className="cc-balance-group cc-balance-group--result">
          <h4 className="cc-balance-group__title">יתרה שנשארה בקופה</h4>
          <div className="cc-remaining">
            <div>
              <span className="cc-remaining__lbl">₪ מזומן</span>
              <strong dir="ltr">{fmtWeekFlowAmount("ILS", num(drawerRemainingIls))}</strong>
            </div>
            <div>
              <span className="cc-remaining__lbl">$ מזומן</span>
              <strong dir="ltr">{fmtWeekFlowAmount("USD", num(drawerRemainingUsd))}</strong>
            </div>
          </div>
          <p className="cc-remaining__formula">
            ₪ = ספירה − הוצאות − רכישת מט"ח · $ = ספירה + מט"ח − העברה לטורקיה − הוצאות
          </p>
        </div>
      </div>
    </section>
  );
}

export default BalancesSection;
