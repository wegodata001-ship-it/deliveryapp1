"use client";

import { Home } from "lucide-react";
import { memo } from "react";

export type PaymentNavigatorProps = {
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  onSearchSubmit: () => void;
  searchBusy?: boolean;
  searchPlaceholder?: string | null;
  onHome: () => void;
  actionsDisabled?: boolean;
};

function PaymentNavigatorInner({
  searchValue,
  onSearchValueChange,
  onSearchSubmit,
  searchBusy = false,
  searchPlaceholder,
  onHome,
  actionsDisabled = false,
}: PaymentNavigatorProps) {
  const busy = searchBusy || actionsDisabled;

  return (
    <div
      className="payment-navigator payment-navigator--capture"
      dir="ltr"
      aria-label="חיפוש קוד תשלום וקליטה חדשה"
    >
      <button
        type="button"
        data-testid="payment-capture-home"
        className="payment-navigator-home"
        aria-label="קליטת תשלום חדשה"
        title="קליטת תשלום חדשה"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          if (busy) return;
          onHome();
        }}
      >
        <Home size={18} strokeWidth={2.2} aria-hidden />
      </button>

      <form
        className="payment-navigator-search payment-navigator-search--primary"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSearchSubmit();
        }}
      >
        <input
          type="search"
          dir="ltr"
          className="payment-navigator-code payment-navigator-code--search"
          aria-label="חיפוש קוד תשלום"
          placeholder={searchPlaceholder?.trim() || "7 / 0007 / TR-P-000007"}
          value={searchValue}
          disabled={searchBusy}
          onChange={(e) => onSearchValueChange(e.target.value)}
        />
        {searchBusy ? (
          <span className="payment-navigator-search-busy" aria-live="polite">
            <span className="payment-modal-save-spinner" aria-hidden />
            טוען תשלום...
          </span>
        ) : null}
      </form>
    </div>
  );
}

function propsEqual(a: PaymentNavigatorProps, b: PaymentNavigatorProps): boolean {
  return (
    a.searchValue === b.searchValue &&
    a.searchBusy === b.searchBusy &&
    a.searchPlaceholder === b.searchPlaceholder &&
    a.actionsDisabled === b.actionsDisabled &&
    a.onHome === b.onHome &&
    a.onSearchValueChange === b.onSearchValueChange &&
    a.onSearchSubmit === b.onSearchSubmit
  );
}

export const PaymentNavigator = memo(PaymentNavigatorInner, propsEqual);
