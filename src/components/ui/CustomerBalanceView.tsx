"use client";

import {
  formatCustomerBalanceDisplay,
  formatFromInternalSigned,
  formatFromInternalSignedString,
  type CustomerBalanceDisplayView,
} from "@/lib/customer-balance";

type Props =
  | { businessSigned: number; currency?: "ILS" | "USD"; compact?: boolean }
  | { internalSigned: number; currency?: "ILS" | "USD"; compact?: boolean }
  | { internalSignedRaw: string; currency?: "ILS" | "USD"; compact?: boolean };

function resolveView(props: Props): CustomerBalanceDisplayView {
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
