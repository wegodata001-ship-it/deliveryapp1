"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Circle,
  CreditCard,
  Landmark,
  Package,
  Receipt,
  XCircle,
} from "lucide-react";
import type { CashDailyMethodId, CashDailyStatusKind } from "@/lib/cash-control-daily";

export const METHOD_LUCIDE: Record<CashDailyMethodId, LucideIcon> = {
  CASH_ILS: Banknote,
  CASH_USD: Banknote,
  CREDIT: CreditCard,
  CHECK: Receipt,
  BANK_TRANSFER: Landmark,
  OTHER: Package,
};

export function StatusIcon({ kind, size = 14 }: { kind: CashDailyStatusKind; size?: number }) {
  if (kind === "ok") return <CheckCircle2 size={size} aria-hidden />;
  if (kind === "warn") return <AlertTriangle size={size} aria-hidden />;
  if (kind === "critical") return <XCircle size={size} aria-hidden />;
  return <Circle size={size} aria-hidden />;
}

export function MethodIcon({ method, size = 14 }: { method: CashDailyMethodId; size?: number }) {
  const Icon = METHOD_LUCIDE[method];
  return <Icon size={size} aria-hidden />;
}
