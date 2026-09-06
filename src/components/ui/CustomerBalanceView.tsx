"use client";

import {
  formatCustomerBalanceDisplay,
  formatFromInternalSigned,
  formatFromInternalSignedString,
  type CustomerBalanceDisplayView,
} from "@/lib/customer-balance";
import { buildCustomerFinancialState } from "@/lib/customer-account-balances-shared";

type Props =
  | { openDebtUsd: number; customerCreditUsd: number; currency?: "ILS" | "USD"; compact?: boolean }
  | { businessSigned: number; currency?: "ILS" | "USD"; compact?: boolean }
  | { internalSigned: number; currency?: "ILS" | "USD"; compact?: boolean }
  | { internalSignedRaw: string; currency?: "ILS" | "USD"; compact?: boolean };

function resolveView(props: Props): CustomerBalanceDisplayView {
  if ("openDebtUsd" in props && "customerCreditUsd" in props) {
    const state = buildCustomerFinancialState({
      openDebtUsd: props.openDebtUsd,
      availableCreditUsd: props.customerCreditUsd,
    });
    const className =
      state.tone === "debt"
        ? "adm-balance-kind adm-balance-kind--debt"
        : state.tone === "credit"
          ? "adm-balance-kind adm-balance-kind--credit"
          : "adm-balance-kind adm-balance-kind--even";
    return {
      kind: state.statusKind,
      badge: state.financialStatus === "DEBT" ? "חוב" : state.financialStatus === "CREDIT" ? "זכות" : "מאוזן",
      label: state.statusLabel,
      className,
      primaryText: state.headline,
      amountFormatted: state.amountFormatted,
    };
  }
  if ("businessSigned" in props) {
    return formatCustomerBalanceDisplay(props.businessSigned, props.currency ?? "ILS");
  }
  if ("internalSigned" in props) {
    return formatFromInternalSigned(props.internalSigned, props.currency ?? "ILS");
  }
  return formatFromInternalSignedString(props.internalSignedRaw, props.currency ?? "ILS");
}

/** תצוגת יתרה אחידה: חוב פתוח (אדום) / יתרת זכות (ירוק) / מאוזן (אפור) */
export function CustomerBalanceView(props: Props) {
  const view = resolveView(props);
  const compact = "compact" in props && props.compact;

  if (compact) {
    return (
      <span className={view.className} title={view.primaryText}>
        {view.badge} {view.label}
      </span>
    );
  }

  return (
    <span className={view.className}>
      <span aria-hidden>{view.badge}</span> {view.primaryText}
    </span>
  );
}

export function customerBalanceViewFromProps(props: Props): CustomerBalanceDisplayView {
  return resolveView(props);
}
