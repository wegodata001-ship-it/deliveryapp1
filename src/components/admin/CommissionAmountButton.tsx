"use client";

import {
  COMMISSION_CHANGED_LABEL,
  formatCommissionUsdCompact,
} from "@/lib/commission-lineage-view";

type Props = {
  amountUsd: number;
  changed?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  /** קידומת "עמלה" בתוך הצ'יפ */
  showLabel?: boolean;
  /** צ'יפ צר לטבלאות — בלי שבירת שורה ובלי $ 23.00 */
  compact?: boolean;
  ariaLabel?: string;
  className?: string;
  title?: string;
};

export function CommissionAmountButton({
  amountUsd,
  changed = false,
  onClick,
  disabled = false,
  showLabel = false,
  compact = false,
  ariaLabel,
  className,
  title,
}: Props) {
  const amount = formatCommissionUsdCompact(amountUsd);
  const label =
    ariaLabel ??
    (changed ? `פירוט עמלות ${amount} — ${COMMISSION_CHANGED_LABEL}` : `פירוט עמלות ${amount}`);

  return (
    <button
      type="button"
      dir="rtl"
      className={[
        "commission-amount-btn",
        changed ? "commission-amount-btn--changed" : "",
        compact ? "commission-amount-btn--compact" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      disabled={disabled || !onClick}
      aria-label={label}
      title={title ?? label}
    >
      {showLabel || changed ? <span className="commission-amount-btn__k">עמלה</span> : null}
      <span className="commission-amount-btn__v" dir="ltr">
        {amount}
      </span>
      {changed ? (
        <>
          <span className="commission-amount-btn__dot" aria-hidden>
            ·
          </span>
          <span className="commission-amount-btn__changed">{COMMISSION_CHANGED_LABEL}</span>
        </>
      ) : null}
    </button>
  );
}
