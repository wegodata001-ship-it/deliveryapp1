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
import { allCashControlChannels } from "@/lib/cash-control-channel";

function iconForChannel(method: CashDailyMethodId): LucideIcon {
  if (method.startsWith("CASH_")) return Banknote;
  if (method.startsWith("BANK_TRANSFER")) return Landmark;
  if (method.startsWith("CREDIT_CARD")) return CreditCard;
  if (method.startsWith("CHECK")) return Receipt;
  return Package;
}

export const METHOD_LUCIDE: Record<CashDailyMethodId, LucideIcon> = Object.fromEntries(
  allCashControlChannels().map((id) => [id, iconForChannel(id)]),
) as Record<CashDailyMethodId, LucideIcon>;

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
