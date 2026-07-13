"use client";

import { Banknote, Building2, CreditCard, FileText, MoreHorizontal } from "lucide-react";
import type { CashExpensePaymentMethod } from "@/lib/cash-expense-payment-method";
import { CASH_EXPENSE_PAYMENT_METHODS } from "@/lib/cash-expense-payment-method";

const ICONS: Record<CashExpensePaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  CREDIT_CARD: CreditCard,
  CHECK: FileText,
  BANK_TRANSFER: Building2,
  OTHER: MoreHorizontal,
};

export type CashExpensePaymentMethodSelectProps = {
  value: CashExpensePaymentMethod;
  onChange: (value: CashExpensePaymentMethod) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
};

export function CashExpensePaymentMethodSelect({
  value,
  onChange,
  disabled,
  className = "cc-input",
  id,
}: CashExpensePaymentMethodSelectProps) {
  return (
    <select
      id={id}
      className={className}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as CashExpensePaymentMethod)}
    >
      {CASH_EXPENSE_PAYMENT_METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
    </select>
  );
}

export function PaymentMethodIcon({
  method,
  size = 14,
}: {
  method: CashExpensePaymentMethod | string;
  size?: number;
}) {
  const norm = (method ?? "CASH").toUpperCase() as CashExpensePaymentMethod;
  const Icon = ICONS[norm in ICONS ? norm : "CASH"] ?? Banknote;
  return <Icon size={size} aria-hidden />;
}

export default CashExpensePaymentMethodSelect;
