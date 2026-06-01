import type { PaymentMethod } from "@prisma/client";
import {
  createDefaultPaymentLine,
  type PaymentLine,
  type PaymentLineCurrency,
  type PaymentLineMethod,
  type PaymentLineVatMode,
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

function mapCurrencyToken(token: string): PaymentLineCurrency {
  return token === "$" ? "USD" : "ILS";
}

function mapVatModeToken(token: string): PaymentLineVatMode {
  if (token === "EXEMPT" || token === "BEFORE_VAT" || token === "INCLUDING_VAT") return token;
  return "INCLUDING_VAT";
}

function mapMethodToken(token: string): PaymentLineMethod {
  if (token === "CREDIT" || token === "BANK_TRANSFER" || token === "CASH" || token === "CHECK" || token === "OTHER")
    return token;
  return "CASH";
}

function mapPrismaMethod(m: PaymentMethod | null | undefined): PaymentLineMethod {
  if (m === "CREDIT") return "CREDIT";
  if (m === "BANK_TRANSFER") return "BANK_TRANSFER";
  if (m === "CASH") return "CASH";
  if (m === "CHECK") return "CHECK";
  return "OTHER";
}

function parseAmountToken(raw: string): number | "" {
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : "";
}

function parseLinesFromNotes(notes: string | null | undefined): PaymentLine[] {
  const txt = (notes ?? "").trim();
  if (!txt) return [];
  const lines = txt
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("#"));

  const parsed: PaymentLine[] = [];
  for (const line of lines) {
    const dualUsd = line.match(/USD\s+\$([\d.,]+)/i);
    const dualIls = line.match(/ILS\s+₪([\d.,]+)/i);
    if (dualUsd || dualIls) {
      const usdMethod = line.match(/USD\s+\$[\d.,]+\s·\s([A-Z_]+)/)?.[1];
      const ilsMethod = line.match(/ILS\s+₪[\d.,]+\s·\s([A-Z_]+)/)?.[1];
      const vatMatch = line.match(/vatMode=([A-Z_]+)/)?.[1];
      parsed.push({
        ...createDefaultPaymentLine(`hist_${parsed.length + 1}`),
        usdAmount: dualUsd ? parseAmountToken(dualUsd[1] ?? "0") : "",
        ilsAmount: dualIls ? parseAmountToken(dualIls[1] ?? "0") : "",
        usdPaymentMethod: mapMethodToken(usdMethod ?? "CASH"),
        ilsPaymentMethod: mapMethodToken(ilsMethod ?? "CASH"),
        vatMode: mapVatModeToken(vatMatch ?? "INCLUDING_VAT"),
        usdNote: line.match(/usdNote=([^|]+)/)?.[1]?.trim() ?? "",
        ilsNote: line.match(/ilsNote=([^|]+)/)?.[1]?.trim() ?? "",
      });
      continue;
    }

    const m = line.match(/^#\d+\s+([$₪])\s?([\d.,]+)\s·\s([A-Z_]+)\s·\s([A-Z_]+)(?:\s\|\s.*)?$/);
    if (!m) continue;
    const noteMatch = line.match(/\|\s*note=(.*)$/);
    const cur = mapCurrencyToken(m[1] ?? "$");
    const amt = parseAmountToken(m[2] ?? "0");
    const base = createDefaultPaymentLine(`hist_${parsed.length + 1}`);
    parsed.push({
      ...base,
      vatMode: mapVatModeToken(m[3] ?? "INCLUDING_VAT"),
      ...(cur === "USD"
        ? { usdAmount: amt, usdPaymentMethod: mapMethodToken(m[4] ?? "CASH"), usdNote: noteMatch?.[1]?.trim() ?? "" }
        : { ilsAmount: amt, ilsPaymentMethod: mapMethodToken(m[4] ?? "CASH"), ilsNote: noteMatch?.[1]?.trim() ?? "" }),
    });
  }
  return parsed;
}

function lineFromDbRow(row: {
  amountUsd: { toString(): string } | null;
  amountIls: { toString(): string } | null;
  usdPaymentMethod: PaymentMethod | null;
  ilsPaymentMethod: PaymentMethod | null;
  paymentMethod: PaymentMethod | null;
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
  paymentMethod: PaymentMethod | null;
  usdPaymentMethod: PaymentMethod | null;
  ilsPaymentMethod: PaymentMethod | null;
  usdNote: string | null;
  ilsNote: string | null;
  notes: string | null;
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

    const parsedLines = parseLinesFromNotes(row.notes);
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
  } finally {
    paymentsPerfTimeEnd("payments.entry.db");
  }

  if (!row) return null;
  return transformPaymentEntryRow(row);
}
