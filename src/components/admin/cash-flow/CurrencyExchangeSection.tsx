"use client";

import { useEffect, useState } from "react";
import { fmtWeekFlowAmount } from "@/lib/cash-control-week-flow";
import { num } from "@/components/admin/cash-flow/shared";

export type CurrencyExchangeSectionProps = {
  fxPurchaseIls: string | null;
  fxPurchaseUsd: string | null;
  editable: boolean;
  saving: boolean;
  onSave: (patch: { fxPurchaseIls: string | null; fxPurchaseUsd: string | null }) => void;
};

/** אזור 6 — רכישת מט"ח (₪ → $) */
export function CurrencyExchangeSection({
  fxPurchaseIls,
  fxPurchaseUsd,
  editable,
  saving,
  onSave,
}: CurrencyExchangeSectionProps) {
  const [ils, setIls] = useState("");
  const [usd, setUsd] = useState("");

  useEffect(() => {
    setIls(fxPurchaseIls ?? "");
    setUsd(fxPurchaseUsd ?? "");
  }, [fxPurchaseIls, fxPurchaseUsd]);

  const commit = () => onSave({ fxPurchaseIls: ils.trim() || null, fxPurchaseUsd: usd.trim() || null });
  const rate = num(ils) > 0 && num(usd) > 0 ? (num(ils) / num(usd)).toFixed(3) : null;

  return (
    <section className="cc-block cc-block--fx cc-slide">
      <header className="cc-block__head">
        <div className="cc-block__title">
          <span className="cc-block__dot cc-block__dot--teal" aria-hidden />
          רכישת מט"ח
        </div>
        {rate ? <span className="cc-block__note">שער ממוצע ≈ {rate}</span> : null}
      </header>
      <div className="cc-count-form">
        <label className="cc-count-field">
          <span className="cc-count-field__lbl">💱 ₪ שולם</span>
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
            <span className="cc-count-readonly">{fmtWeekFlowAmount("ILS", num(fxPurchaseIls))}</span>
          )}
        </label>
        <label className="cc-count-field">
          <span className="cc-count-field__lbl">💵 $ התקבל</span>
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
            <span className="cc-count-readonly">{fmtWeekFlowAmount("USD", num(fxPurchaseUsd))}</span>
          )}
        </label>
      </div>
    </section>
  );
}

export default CurrencyExchangeSection;
