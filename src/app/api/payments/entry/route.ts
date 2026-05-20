import { NextResponse } from "next/server";
import type { PaymentMethod } from "@prisma/client";
import {
  createDefaultPaymentLine,
  type PaymentLine,
  type PaymentLineCurrency,
  type PaymentLineMethod,
  type PaymentLineVatMode,
} from "@/lib/payment-updated";
import { getSessionPayload } from "@/lib/admin-auth";
import { formatLocalHm, formatLocalYmd } from "@/lib/work-week";
import { prisma } from "@/lib/prisma";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

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

export async function GET(req: Request) {
  return withPerfTimer("api.payments.entry.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const id = (searchParams.get("id") ?? "").trim();
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

      const row = await prisma.payment.findFirst({
        where: { id },
        select: {
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
        },
      });
      if (!row) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
      if (!row.customerId) return NextResponse.json({ error: "Payment has no customer" }, { status: 400 });

      const customer = await prisma.customer.findFirst({
        where: { id: row.customerId, deletedAt: null },
        select: {
          id: true,
          displayName: true,
          customerCode: true,
          oldCustomerCode: true,
          nameEn: true,
          nameHe: true,
          nameAr: true,
          phone: true,
        },
      });

      const parsedLines = parseLinesFromNotes(row.notes);
      const paymentDate = row.paymentDate ?? new Date();
      const cpNum = Number(row.commissionPercent ?? 0);
      const commissionPercentStr =
        Number.isFinite(cpNum) && cpNum > 0 ? String(cpNum) : "0";

      const lines =
        parsedLines.length > 0
          ? parsedLines
          : [lineFromDbRow(row)];

      return NextResponse.json({
        id: row.id,
        paymentCode: row.paymentCode ?? null,
        paymentNumber: row.paymentNumber ?? null,
        paymentDateYmd: formatLocalYmd(paymentDate),
        paymentTimeHm: formatLocalHm(paymentDate),
        dollarRate: Number(row.exchangeRate ?? 0) > 0 ? Number(row.exchangeRate).toFixed(4) : null,
        commissionPercent: commissionPercentStr,
        customer: {
          id: row.customerId,
          displayName: customer?.displayName ?? "",
          customerCode: customer?.customerCode ?? "",
          customerIndex: customer?.oldCustomerCode ?? "",
          nameEn: customer?.nameEn ?? customer?.nameHe ?? "",
          nameAr: customer?.nameAr ?? "",
          phone: customer?.phone ?? "",
        },
        lines,
      });
    } catch (error) {
      perfError("api.payments.entry.GET.failed", error);
      return NextResponse.json({ error: "טעינת קליטת תשלום נכשלה" }, { status: 500 });
    }
  });
}
