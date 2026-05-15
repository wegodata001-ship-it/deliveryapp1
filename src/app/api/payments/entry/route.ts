import { NextResponse } from "next/server";
import type { PaymentLine, PaymentLineCurrency, PaymentLineMethod, PaymentLineVatMode } from "@/lib/payment-updated";
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

function parseAmountToken(raw: string): number {
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
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
    const m = line.match(/^#\d+\s+([$₪])\s?([\d.,]+)\s·\s([A-Z_]+)\s·\s([A-Z_]+)(?:\s\|\s.*)?$/);
    if (!m) continue;
    const noteMatch = line.match(/\|\s*note=(.*)$/);
    parsed.push({
      id: `hist_${parsed.length + 1}`,
      amount: parseAmountToken(m[2] ?? "0"),
      currency: mapCurrencyToken(m[1] ?? "$"),
      vatMode: mapVatModeToken(m[3] ?? "INCLUDING_VAT"),
      paymentMethod: mapMethodToken(m[4] ?? "CASH"),
      note: noteMatch?.[1]?.trim() ?? "",
    });
  }
  return parsed;
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
      const fallbackUsd = Number(row.amountUsd ?? 0);
      const paymentDate = row.paymentDate ?? new Date();
      const cpNum = Number(row.commissionPercent ?? 0);
      const commissionPercentStr =
        Number.isFinite(cpNum) && cpNum > 0 ? String(cpNum) : "0";

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
        lines:
          parsedLines.length > 0
            ? parsedLines
            : [
                {
                  id: "hist_1",
                  amount: fallbackUsd > 0 ? fallbackUsd : "",
                  currency: "USD",
                  vatMode: "INCLUDING_VAT",
                  paymentMethod: "CASH",
                  note: "",
                },
              ],
      });
    } catch (error) {
      perfError("api.payments.entry.GET.failed", error);
      return NextResponse.json({ error: "טעינת קליטת תשלום נכשלה" }, { status: 500 });
    }
  });
}
