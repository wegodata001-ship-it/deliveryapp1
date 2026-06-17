import type { PaymentRecordStatus } from "@prisma/client";
import { normalizePaymentMethodId } from "@/lib/payment-method-slugs";
import { parsePaymentLinesFromNotes } from "@/lib/ledger-payment-detail";
import {
  createDefaultPaymentLine,
  type PaymentLine,
  type PaymentLineMethod,
} from "@/lib/payment-updated";
import { formatLocalHm, formatLocalYmd } from "@/lib/work-week";
import { prisma } from "@/lib/prisma";
import { paymentsPerfTimeEnd, paymentsPerfTimeStart } from "@/lib/payments-perf";

export type PaymentEntryPayload = {
  id: string;
  paymentCode: string | null;
  paymentNumber: number | null;
  paymentDateYmd: string;
  paymentTimeHm: string;
  dollarRate: string | null;
  commissionPercent: string;
  status: PaymentRecordStatus;
  cancelReason: string | null;
  customer: {
    id: string;
    displayName: string;
    customerCode: string;
    customerIndex: string;
    nameEn: string;
    nameAr: string;
    phone: string;
  };
  lines: PaymentLine[];
};

function mapPrismaMethod(m: string | null | undefined): PaymentLineMethod {
  const id = normalizePaymentMethodId(m ?? "");
  if (id === "CREDIT") return "CREDIT";
  if (id === "BANK_TRANSFER" || id === "BANK_TRANSFER_DONE") return "BANK_TRANSFER";
  if (id === "CASH") return "CASH";
  if (id === "CHECK") return "CHECK";
  return id || "OTHER";
}

function lineFromDbRow(row: {
  amountUsd: { toString(): string } | null;
  amountIls: { toString(): string } | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  paymentMethod: string | null;
  usdNote: string | null;
  ilsNote: string | null;
}): PaymentLine {
  const usdN = Number(row.amountUsd ?? 0);
  const ilsN = Number(row.amountIls ?? 0);
  const line = createDefaultPaymentLine("hist_1");
  return {
    ...line,
    usdAmount: Number.isFinite(usdN) && usdN > 0 ? usdN : "",
    ilsAmount: Number.isFinite(ilsN) && ilsN > 0 ? ilsN : "",
    usdPaymentMethod: mapPrismaMethod(row.usdPaymentMethod ?? row.paymentMethod),
    ilsPaymentMethod: mapPrismaMethod(row.ilsPaymentMethod ?? row.paymentMethod),
    usdNote: row.usdNote ?? "",
    ilsNote: row.ilsNote ?? "",
  };
}

function transformPaymentEntryRow(row: {
  id: string;
  paymentCode: string | null;
  paymentNumber: number | null;
  paymentDate: Date | null;
  exchangeRate: { toString(): string } | null;
  commissionPercent: { toString(): string } | null;
  amountUsd: { toString(): string } | null;
  amountIls: { toString(): string } | null;
  paymentMethod: string | null;
  usdPaymentMethod: string | null;
  ilsPaymentMethod: string | null;
  usdNote: string | null;
  ilsNote: string | null;
  notes: string | null;
  status: PaymentRecordStatus;
  cancelReason: string | null;
  customerId: string | null;
  customer: {
    id: string;
    displayName: string;
    customerCode: string | null;
    oldCustomerCode: string | null;
    nameEn: string | null;
    nameHe: string | null;
    nameAr: string | null;
    phone: string | null;
    deletedAt: Date | null;
  } | null;
}): PaymentEntryPayload | null {
  paymentsPerfTimeStart("payments.entry.transform");
  try {
    if (!row.customerId) return null;
    const cust = row.customer;
    if (!cust || cust.deletedAt != null) return null;

    const parsedLines = parsePaymentLinesFromNotes(row.notes);
    const paymentDate = row.paymentDate ?? new Date();
    const cpNum = Number(row.commissionPercent ?? 0);
    const commissionPercentStr = Number.isFinite(cpNum) && cpNum > 0 ? String(cpNum) : "0";
    const lines = parsedLines.length > 0 ? parsedLines : [lineFromDbRow(row)];

    return {
      id: row.id,
      paymentCode: row.paymentCode ?? null,
      paymentNumber: row.paymentNumber ?? null,
      paymentDateYmd: formatLocalYmd(paymentDate),
      paymentTimeHm: formatLocalHm(paymentDate),
      dollarRate: Number(row.exchangeRate ?? 0) > 0 ? Number(row.exchangeRate).toFixed(4) : null,
      commissionPercent: commissionPercentStr,
      status: row.status,
      cancelReason: row.cancelReason?.trim() || null,
      customer: {
        id: row.customerId,
        displayName: cust.displayName ?? "",
        customerCode: cust.customerCode ?? "",
        customerIndex: cust.oldCustomerCode ?? "",
        nameEn: cust.nameEn ?? cust.nameHe ?? "",
        nameAr: cust.nameAr ?? "",
        phone: cust.phone ?? "",
      },
      lines,
    };
  } finally {
    paymentsPerfTimeEnd("payments.entry.transform");
  }
}

const paymentEntrySelect = {
  id: true,
  paymentCode: true,
  paymentNumber: true,
  paymentDate: true,
  exchangeRate: true,
  commissionPercent: true,
  amountUsd: true,
  amountIls: true,
  paymentMethod: true,
  usdPaymentMethod: true,
  ilsPaymentMethod: true,
  usdNote: true,
  ilsNote: true,
  notes: true,
  status: true,
  cancelReason: true,
  customerId: true,
  customer: {
    select: {
      id: true,
      displayName: true,
      customerCode: true,
      oldCustomerCode: true,
      nameEn: true,
      nameHe: true,
      nameAr: true,
      phone: true,
      deletedAt: true,
    },
  },
} as const;

/** טוען קליטת תשלום + לקוח בשאילתה אחת */
export async function loadPaymentEntryPayload(id: string): Promise<PaymentEntryPayload | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;

  paymentsPerfTimeStart("payments.entry.db");
  let row;
  try {
    row = await prisma.payment.findFirst({
      where: { id: trimmed, customerId: { not: null } },
      select: paymentEntrySelect,
    });
    if (row && !row.paymentCode && row.paymentNumber != null) {
      const primary = await prisma.payment.findFirst({
        where: {
          paymentNumber: row.paymentNumber,
          paymentCode: { not: null },
          customerId: { not: null },
        },
        select: paymentEntrySelect,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      if (primary) row = primary;
    }
  } finally {
    paymentsPerfTimeEnd("payments.entry.db");
  }

  if (!row) return null;
  return transformPaymentEntryRow(row);
}
