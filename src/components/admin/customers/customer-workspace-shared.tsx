"use client";

import {
  ArrowLeftRight,
  Banknote,
  CircleDollarSign,
  CreditCard,
  FileCheck,
  Maximize2,
} from "lucide-react";
import { formatCustomerBalanceDisplay } from "@/lib/customer-balance";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { OS } from "@/lib/order-status-slugs";
import { paymentMethodTone, type PaymentMethodTone } from "@/lib/payments-source-shared";

export type WorkspaceLayoutMode = "combined" | "customers" | "orders" | "payments";
export type WorkspaceTableKey = "customers" | "orders" | "payments";

export const WORKSPACE_LAYOUT_OPTIONS: { value: WorkspaceLayoutMode; label: string }[] = [
  { value: "combined", label: "הכל" },
  { value: "customers", label: "לקוחות" },
  { value: "orders", label: "הזמנות" },
  { value: "payments", label: "תשלומים" },
];

const ORDER_IN_PROGRESS: readonly string[] = [
  OS.WAITING_FOR_EXECUTION,
  OS.WITHDRAWAL_FROM_SUPPLIER,
  OS.SENT,
  OS.WAITING_FOR_CHINA_EXECUTION,
];

export function balanceClass(balanceUsd: string): string {
  const n = parseMoneyStringOrZero(balanceUsd);
  const view = formatCustomerBalanceDisplay(n, "USD");
  if (view.kind === "debt") return "adm-ws-amt adm-ws-amt--debt";
  if (view.kind === "credit") return "adm-ws-amt adm-ws-amt--credit";
  return "adm-ws-amt adm-ws-amt--even";
}

export function balanceText(balanceUsd: string): string {
  return formatCustomerBalanceDisplay(parseMoneyStringOrZero(balanceUsd), "USD").amountFormatted;
}

export function fmtUsd(s: string): string {
  return formatUsdDisplay(parseMoneyStringOrZero(s));
}

export function orderBalanceClass(balanceUsd: string): string {
  const n = parseMoneyStringOrZero(balanceUsd);
  if (n > 0.01) return "adm-ws-amt adm-ws-amt--debt";
  if (n < -0.01) return "adm-ws-amt adm-ws-amt--credit";
  return "adm-ws-amt adm-ws-amt--even";
}

export function orderStatusBadgeClass(status: string): string {
  if (status === OS.COMPLETED) return "adm-ws-badge adm-ws-badge--ready";
  if (status === OS.CANCELLED) return "adm-ws-badge adm-ws-badge--cancelled";
  if (status === OS.OPEN) return "adm-ws-badge adm-ws-badge--open";
  if (ORDER_IN_PROGRESS.includes(status)) return "adm-ws-badge adm-ws-badge--progress";
  if (status === OS.DEBT_WITHDRAWAL) return "adm-ws-badge adm-ws-badge--withdrawal";
  return "adm-ws-badge adm-ws-badge--neutral";
}

/** תצוגת סטטוס הזמנה — תווית ו-badge בלבד (עיצוב בלבד) */
export function orderStatusDisplay(
  status: string,
  fallbackLabel: string,
): { label: string; className: string } {
  if (status === OS.COMPLETED) {
    return { label: "מוכן", className: orderStatusBadgeClass(status) };
  }
  if (status === OS.CANCELLED) {
    return { label: "ביטול", className: orderStatusBadgeClass(status) };
  }
  if (status === OS.DEBT_WITHDRAWAL) {
    return { label: "משיכה מחוב", className: orderStatusBadgeClass(status) };
  }
  if (status === OS.OPEN) {
    return { label: "פתוחה", className: orderStatusBadgeClass(status) };
  }
  if (ORDER_IN_PROGRESS.includes(status)) {
    return { label: fallbackLabel.trim() || "בתהליך", className: orderStatusBadgeClass(status) };
  }
  return { label: fallbackLabel.trim() || "—", className: orderStatusBadgeClass(status) };
}

function paymentMethodBadgeClass(tone: PaymentMethodTone): string {
  return `adm-ws-pay-badge adm-ws-pay-badge--${tone}`;
}

export function PaymentMethodBadge({
  method,
  label,
}: {
  method: string | null;
  label: string;
}) {
  if (label === "—") return <span className="adm-ws-muted">—</span>;
  const tone = paymentMethodTone(method);
  const Icon =
    tone === "cash"
      ? Banknote
      : tone === "credit"
        ? CreditCard
        : tone === "bank"
          ? ArrowLeftRight
          : tone === "check"
            ? FileCheck
            : CircleDollarSign;
  return (
    <span className={paymentMethodBadgeClass(tone)}>
      <Icon size={14} strokeWidth={2.25} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function WorkspaceExpandButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      className="adm-cust-workspace__expand-btn"
      aria-label={`הרחב — ${label}`}
      title="הרחב"
      onClick={onClick}
    >
      <Maximize2 size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
