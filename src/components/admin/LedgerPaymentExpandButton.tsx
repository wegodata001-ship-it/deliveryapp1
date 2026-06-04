"use client";

type Props = {
  expanded: boolean;
  onToggle: () => void;
};

/** כפתור הרחבה — ▶ / ▼ */
export function LedgerPaymentExpandButton({ expanded, onToggle }: Props) {
  return (
    <button
      type="button"
      className="adm-ledger-payment-expand"
      aria-expanded={expanded}
      aria-label={expanded ? "סגור פירוט תשלום" : "הצג פירוט תשלום"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <span className="adm-ledger-payment-expand-icon" aria-hidden>
        {expanded ? "▼" : "▶"}
      </span>
    </button>
  );
}
