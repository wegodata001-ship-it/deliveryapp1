/**
 * SSOT ליתרת זכות לקוח — נפרד מיתרת עמלות.
 * מקור: תשלומי CUSTOMER_CREDIT פעילים (עודף מתשלום) שלא קוזזו.
 */
import type { CustomerBalanceScope } from "@/lib/customer-balance-calculator";
import { findActiveCustomerPayments } from "@/lib/payment-record-status";
import { prisma } from "@/lib/prisma";
import { roundMoney2 } from "@/lib/payment-updated";
import { openDebtScopeForWorkCountry } from "@/lib/customer-open-debt";
import { normalizeWorkCountryCode, type WorkCountryCode } from "@/lib/work-country";
import { formatLocalYmd } from "@/lib/work-week";
import { CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX } from "@/lib/cash-control-internal-payments";

export type CustomerCreditMovementType =
  | "OVERPAYMENT_CREDIT"
  | "CREDIT_APPLIED"
  | "CREDIT_ADJUSTMENT";

export type CustomerCreditMovementRow = {
  id: string;
  customerId: string;
  dateYmd: string;
  createdAt: string;
  type: CustomerCreditMovementType;
  actionLabel: string;
  sourceDocument: string;
  paymentId: string | null;
  paymentCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  amountUsd: number;
  direction: "CREDIT" | "DEBIT";
  reason: string | null;
  balanceAfterUsd: number;
  createdById: string | null;
};

export type CustomerCreditLedgerPayload = {
  customerId: string;
  currentBalanceUsd: number;
  movements: CustomerCreditMovementRow[];
};

function workCountryWhere(scope: CustomerBalanceScope = {}): { countryCode?: WorkCountryCode } {
  if (!scope.sourceCountry) return {};
  const wc = normalizeWorkCountryCode(
    scope.sourceCountry === "TURKEY"
      ? "TURKEY"
      : scope.sourceCountry === "CHINA"
        ? "CHINA"
        : scope.sourceCountry === "UAE"
          ? "UAE"
          : "TURKEY",
  );
  return wc ? { countryCode: wc } : {};
}

export function creditScopeFromWorkCountry(workCountry: string | null | undefined): CustomerBalanceScope {
  return openDebtScopeForWorkCountry(workCountry);
}

export async function getCustomerCreditBalanceUsd(
  customerId: string,
  scope: CustomerBalanceScope = {},
): Promise<number> {
  const cid = customerId.trim();
  if (!cid) return 0;
  const map = await getCustomerCreditBalancesUsdMany([cid], scope);
  return map.get(cid) ?? 0;
}

export async function getCustomerCreditBalancesUsdMany(
  customerIds: string[],
  scope: CustomerBalanceScope = {},
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(customerIds.map((id) => id.trim()).filter(Boolean)));
  const out = new Map<string, number>();
  for (const id of ids) out.set(id, 0);
  if (ids.length === 0) return out;

  const rows = await findActiveCustomerPayments({
    where: {
      customerId: { in: ids },
      orderId: null,
      businessType: "CUSTOMER_CREDIT",
      ...workCountryWhere(scope),
    },
    select: { customerId: true, amountUsd: true },
  });
  for (const row of rows) {
    const cid = row.customerId?.trim();
    if (!cid) continue;
    const n = Number(row.amountUsd ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.set(cid, roundMoney2((out.get(cid) ?? 0) + n));
  }
  return out;
}

function parseSourcePaymentCode(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/קשור לקליטה\s+(\S+)/);
  return m?.[1]?.trim() || null;
}

export async function buildCustomerCreditLedger(
  customerId: string,
  scope: CustomerBalanceScope = {},
): Promise<CustomerCreditLedgerPayload> {
  const cid = customerId.trim();
  const countryFilter = workCountryWhere(scope);

  const [creditRows, appliedAudits] = await Promise.all([
    prisma.payment.findMany({
      where: {
        customerId: cid,
        businessType: "CUSTOMER_CREDIT",
        ...countryFilter,
      },
      orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        paymentCode: true,
        paymentNumber: true,
        paymentDate: true,
        createdAt: true,
        amountUsd: true,
        status: true,
        notes: true,
        createdById: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { actionType: "CUSTOMER_CREDIT_APPLIED_TO_ORDER" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        metadata: true,
        userId: true,
      },
    }),
  ]);

  type RawMove = Omit<CustomerCreditMovementRow, "balanceAfterUsd">;
  const raw: RawMove[] = [];

  for (const p of creditRows) {
    const amt = Number(p.amountUsd ?? 0);
    if (!(amt > 0.001)) continue;
    const active = p.status === "ACTIVE";
    const linkedCode =
      p.paymentCode?.trim() ||
      parseSourcePaymentCode(p.notes) ||
      (p.paymentNumber != null ? `#${p.paymentNumber}` : p.id.slice(0, 8));

    if (active) {
      raw.push({
        id: `credit-${p.id}`,
        customerId: cid,
        dateYmd: p.paymentDate ? formatLocalYmd(new Date(p.paymentDate)) : formatLocalYmd(p.createdAt),
        createdAt: p.createdAt.toISOString(),
        type: "OVERPAYMENT_CREDIT",
        actionLabel: "תשלום יתר → יתרת זכות",
        sourceDocument: linkedCode,
        paymentId: p.id,
        paymentCode: p.paymentCode,
        orderId: null,
        orderNumber: null,
        amountUsd: roundMoney2(amt),
        direction: "CREDIT",
        reason: p.notes?.includes(CUSTOMER_CREDIT_SURPLUS_NOTE_PREFIX)
          ? "תשלום יתר → יתרת זכות"
          : p.notes?.trim() || null,
        createdById: p.createdById,
      });
    } else {
      raw.push({
        id: `credit-used-${p.id}`,
        customerId: cid,
        dateYmd: formatLocalYmd(p.createdAt),
        createdAt: p.createdAt.toISOString(),
        type: "CREDIT_APPLIED",
        actionLabel: "ניצול יתרת זכות",
        sourceDocument: linkedCode,
        paymentId: p.id,
        paymentCode: p.paymentCode,
        orderId: null,
        orderNumber: null,
        amountUsd: roundMoney2(-amt),
        direction: "DEBIT",
        reason: "יתרה נוצלה",
        createdById: p.createdById,
      });
    }
  }

  for (const log of appliedAudits) {
    const meta = log.metadata as Record<string, unknown> | null;
    if (!meta || String(meta.customerId ?? "") !== cid) continue;
    const appliedRaw =
      typeof meta.appliedUsd === "string"
        ? meta.appliedUsd
        : typeof (meta as { newValue?: { appliedUsd?: string } }).newValue?.appliedUsd === "string"
          ? (meta as { newValue?: { appliedUsd?: string } }).newValue!.appliedUsd!
          : null;
    const applied = appliedRaw ? Number(appliedRaw) : 0;
    if (!(applied > 0.001)) continue;
    raw.push({
      id: `apply-${log.id}`,
      customerId: cid,
      dateYmd: formatLocalYmd(log.createdAt),
      createdAt: log.createdAt.toISOString(),
      type: "CREDIT_APPLIED",
      actionLabel: "ניצול יתרת זכות להזמנה",
      sourceDocument: String(meta.orderNumber ?? meta.orderId ?? "—"),
      paymentId: typeof meta.creditPaymentId === "string" ? meta.creditPaymentId : null,
      paymentCode: null,
      orderId: typeof meta.orderId === "string" ? meta.orderId : null,
      orderNumber: typeof meta.orderNumber === "string" ? meta.orderNumber : null,
      amountUsd: roundMoney2(-applied),
      direction: "DEBIT",
      reason: null,
      createdById: log.userId,
    });
  }

  raw.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let running = 0;
  const movements: CustomerCreditMovementRow[] = raw.map((row) => {
    running = roundMoney2(running + row.amountUsd);
    return { ...row, balanceAfterUsd: running };
  });

  const currentBalanceUsd = await getCustomerCreditBalanceUsd(cid, scope);

  return {
    customerId: cid,
    currentBalanceUsd,
    movements: [...movements].reverse(),
  };
}
