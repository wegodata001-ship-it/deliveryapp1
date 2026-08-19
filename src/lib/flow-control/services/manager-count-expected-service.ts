/**
 * ספירת מנהל — צפוי לפי קליטת תשלום בפועל (SSOT משותף עם בקרת תזרים).
 */

import { CASH_CONTROL_EPS } from "@/lib/cash-control-calculation";
import type { CashDailyIntakeTotals, CashDailyMethodId } from "@/lib/cash-control-daily";
import {
  WEEK_FLOW_LINE_CHANNEL,
  type CashWeekFlowLineId,
} from "@/lib/cash-control-week-flow";
import type { ManagerCountForm } from "@/app/admin/cash-flow/flow-types";
import {
  getFlowPaymentContributions,
  paymentIntakeCaptureKey,
  shouldContributePaymentToFlowIntake,
  type FlowPaymentVatFields,
} from "@/lib/flow-control/flow-calculation-service";

export type ManagerCountExpectedPaymentRow = {
  paymentId: string;
  paymentCode: string | null;
  customerLabel: string;
  orderNumber: string | null;
  /** סכום בשורה — במטבע התשלום בפועל */
  amount: number;
  currency: "ILS" | "USD";
  /** שווי $ לפי snapshot בקליטה — מידע בלבד */
  amountUsdCredit: number | null;
  exchangeRate: number | null;
  timeLabel: string;
};

export type ManagerCountExpectedLine = {
  lineId: CashWeekFlowLineId;
  label: string;
  route: "PS" | "IL";
  currency: "ILS" | "USD";
  formKey: keyof ManagerCountForm;
  expectedAmount: number;
  payments: ManagerCountExpectedPaymentRow[];
};

export type ManagerCountLineStatus = {
  kind: "ok" | "short" | "excess";
  diff: number;
  label: string;
};

const LINE_META: Record<
  CashWeekFlowLineId,
  {
    label: string;
    route: "PS" | "IL";
    currency: "ILS" | "USD";
    formKey: keyof ManagerCountForm;
  }
> = {
  CASH_ILS: {
    label: "מזומן בשקלים — PS",
    route: "PS",
    currency: "ILS",
    formKey: "countedCashIls",
  },
  CASH_USD: {
    label: "מזומן בדולרים — PS",
    route: "PS",
    currency: "USD",
    formKey: "countedCashUsd",
  },
  BANK_TRANSFER: {
    label: "העברות בנקאיות",
    route: "IL",
    currency: "ILS",
    formKey: "countedTransferIls",
  },
  CREDIT: {
    label: "אשראי",
    route: "IL",
    currency: "ILS",
    formKey: "countedCreditIls",
  },
  CHECK: {
    label: "צ'קים",
    route: "IL",
    currency: "ILS",
    formKey: "countedChecksIls",
  },
};

export const MANAGER_COUNT_LINE_IDS: CashWeekFlowLineId[] = [
  "CASH_ILS",
  "CASH_USD",
  "BANK_TRANSFER",
  "CREDIT",
  "CHECK",
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(v: { toString(): string } | null | undefined): number {
  const n = Number(v?.toString() ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function channelToLineId(channel: CashDailyMethodId): CashWeekFlowLineId | null {
  for (const lineId of MANAGER_COUNT_LINE_IDS) {
    if (WEEK_FLOW_LINE_CHANNEL[lineId] === channel) return lineId;
  }
  return null;
}

function formatMoney(currency: "ILS" | "USD", amount: number): string {
  const abs = Math.abs(amount);
  const body =
    currency === "ILS"
      ? abs.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const prefix = currency === "ILS" ? "₪" : "$";
  return amount < 0 ? `-${prefix}${body}` : `${prefix}${body}`;
}

function paymentTimeLabel(p: {
  intakeDate?: Date | string | null;
  paymentDate?: Date | string | null;
  createdAt?: Date | string | null;
}): string {
  const raw = p.intakeDate ?? p.paymentDate ?? p.createdAt;
  if (!raw) return "—";
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  const hm = d.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jerusalem",
  });
  return hm;
}

export type ManagerCountPaymentSource = FlowPaymentVatFields & {
  id: string;
  paymentCode?: string | null;
  intakeDate?: Date | string | null;
  paymentDate?: Date | string | null;
  createdAt?: Date | string | null;
  customer?: { displayName: string | null } | null;
  order?: { orderNumber: string | null } | null;
};

/** ממפה weekPaymentIntake (SSOT) לסכומי צפוי לפי שורת ספירה */
export function expectedAmountsFromIntake(
  intake: CashDailyIntakeTotals,
): Record<CashWeekFlowLineId, number> {
  return {
    CASH_ILS: round2(intake.CASH_ILS ?? 0),
    CASH_USD: round2(intake.CASH_USD ?? 0),
    BANK_TRANSFER: round2(intake.BANK_TRANSFER_ILS ?? 0),
    CREDIT: round2(intake.CREDIT_CARD_ILS ?? 0),
    CHECK: round2(intake.CHECK_ILS ?? 0),
  };
}

/** פירוט תשלומים + סכומי צפוי — מקליטות Payment בפועל בלבד */
export function buildManagerCountExpectedLines(
  payments: ManagerCountPaymentSource[],
): ManagerCountExpectedLine[] {
  const captureKeysWithAlloc = new Set<string>();
  for (const p of payments) {
    if ((p.methodAllocations?.length ?? 0) > 0) {
      captureKeysWithAlloc.add(paymentIntakeCaptureKey(p));
    }
  }

  const buckets = new Map<
    CashWeekFlowLineId,
    { expected: number; payments: ManagerCountExpectedPaymentRow[] }
  >();
  for (const lineId of MANAGER_COUNT_LINE_IDS) {
    buckets.set(lineId, { expected: 0, payments: [] });
  }

  for (const p of payments) {
    if (!shouldContributePaymentToFlowIntake(p, captureKeysWithAlloc)) continue;

    const rate = num(p.exchangeRate);
    const usdCredit = num(p.amountUsd) > CASH_CONTROL_EPS ? round2(num(p.amountUsd)) : null;
    const customerLabel = (p.customer?.displayName ?? "").trim() || "—";
    const orderNumber = (p.order?.orderNumber ?? "").trim() || null;
    const timeLabel = paymentTimeLabel(p);

    for (const c of getFlowPaymentContributions(p)) {
      const lineId = channelToLineId(c.column);
      if (!lineId || c.amount <= CASH_CONTROL_EPS) continue;
      const meta = LINE_META[lineId];
      const bucket = buckets.get(lineId)!;
      bucket.expected = round2(bucket.expected + c.amount);
      bucket.payments.push({
        paymentId: p.id,
        paymentCode: p.paymentCode ?? null,
        customerLabel,
        orderNumber,
        amount: round2(c.amount),
        currency: meta.currency,
        amountUsdCredit:
          meta.currency === "ILS" && usdCredit != null && usdCredit > CASH_CONTROL_EPS
            ? usdCredit
            : meta.currency === "USD"
              ? round2(c.amount)
              : usdCredit,
        exchangeRate: rate > 0 ? rate : null,
        timeLabel,
      });
    }
  }

  return MANAGER_COUNT_LINE_IDS.map((lineId) => {
    const meta = LINE_META[lineId];
    const bucket = buckets.get(lineId)!;
    return {
      lineId,
      label: meta.label,
      route: meta.route,
      currency: meta.currency,
      formKey: meta.formKey,
      expectedAmount: bucket.expected,
      payments: bucket.payments.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel, "he")),
    };
  });
}

export function managerCountLineStatus(
  expected: number,
  counted: number,
  currency: "ILS" | "USD",
): ManagerCountLineStatus {
  const diff = round2(counted - expected);
  if (Math.abs(diff) <= CASH_CONTROL_EPS) {
    return { kind: "ok", diff: 0, label: "🟢 תואם" };
  }
  if (diff < 0) {
    return {
      kind: "short",
      diff,
      label: `🔴 חסר ${formatMoney(currency, Math.abs(diff))}`,
    };
  }
  return {
    kind: "excess",
    diff,
    label: `🟠 עודף ${formatMoney(currency, diff)}`,
  };
}

export function formatManagerCountInput(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) <= CASH_CONTROL_EPS) return "";
  return n.toFixed(2);
}

export function hasSavedManagerCount(
  counted: Partial<Record<CashWeekFlowLineId, string | null>>,
): boolean {
  return MANAGER_COUNT_LINE_IDS.some((id) => {
    const v = counted[id];
    return v != null && String(v).trim() !== "";
  });
}

export function initializeManagerCountFormFields(
  counted: Partial<Record<CashWeekFlowLineId, string | null>>,
  expected: Record<CashWeekFlowLineId, number>,
): Partial<ManagerCountForm> {
  if (hasSavedManagerCount(counted)) return {};
  const out: Partial<ManagerCountForm> = {};
  for (const lineId of MANAGER_COUNT_LINE_IDS) {
    const meta = LINE_META[lineId];
    out[meta.formKey] = formatManagerCountInput(expected[lineId] ?? 0);
  }
  return out;
}

export function sumExpectedByRoute(
  lines: ManagerCountExpectedLine[],
  route: "PS" | "IL",
  currency: "ILS" | "USD",
): number {
  return round2(
    lines
      .filter((l) => l.route === route && l.currency === currency)
      .reduce((s, l) => s + l.expectedAmount, 0),
  );
}

export function sumCountedByRoute(
  form: ManagerCountForm,
  route: "PS" | "IL",
): { ils: number; usd: number } {
  if (route === "PS") {
    return {
      ils: round2(numLike(form.countedCashIls)),
      usd: round2(numLike(form.countedCashUsd)),
    };
  }
  return {
    ils: round2(
      numLike(form.countedTransferIls) +
        numLike(form.countedCreditIls) +
        numLike(form.countedChecksIls),
    ),
    usd: 0,
  };
}

function numLike(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function formatWeekRangeLabel(fromYmd: string, toYmd: string): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-");
    if (!y || !m || !d) return ymd;
    return `${d}/${m}/${y}`;
  };
  return `${fmt(fromYmd)}–${fmt(toYmd)}`;
}
