import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export type CustomerExtrasPayload = {
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
  indexLabel: string | null;
  city: string | null;
  address: string | null;
  balanceUsdDisplay: string;
  balanceUsdNegative: boolean;
  openDebtUsd: number;
  customerCreditUsd: number;
  feeBalanceUsd: number;
  financialStatus: "DEBT" | "BALANCED" | "CREDIT";
};

export async function GET(req: Request) {
  return withPerfTimer("api.customers.extras.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const id = (searchParams.get("id") ?? "").trim();
      if (!id) return NextResponse.json(null);

      const cust = await prisma.customer.findFirst({
        where: { id, deletedAt: null, isActive: true },
        select: {
          nameHe: true,
          nameEn: true,
          nameAr: true,
          phone: true,
          phone2: true,
          oldCustomerCode: true,
          customerCode: true,
          city: true,
          address: true,
        },
      });
      if (!cust) return NextResponse.json(null);

      const country = searchParams.get("country");
      const { getCustomerAccountBalances, financialStateFromAccounts } = await import(
        "@/lib/customer-account-balances"
      );
      const { currentCustomerFinancialScopeForWorkCountry } = await import("@/lib/customer-financial-scope");
      const accounts = await getCustomerAccountBalances(id, currentCustomerFinancialScopeForWorkCountry(country));
      const state = financialStateFromAccounts(accounts);
      const indexLabel = cust.oldCustomerCode?.trim() || cust.customerCode?.trim() || null;

      const payload: CustomerExtrasPayload = {
        nameEn: cust.nameEn ?? cust.nameHe ?? null,
        nameAr: cust.nameAr,
        phone: cust.phone ?? cust.phone2,
        indexLabel,
        city: cust.city?.trim() || null,
        address: cust.address?.trim() || null,
        balanceUsdDisplay: state.displaySignedUsd.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        balanceUsdNegative: state.financialStatus === "CREDIT",
        openDebtUsd: state.openDebtUsd,
        customerCreditUsd: state.customerCreditUsd,
        feeBalanceUsd: state.feeBalanceUsd,
        financialStatus: state.financialStatus,
      };
      return NextResponse.json(payload);
    } catch (error) {
      perfError("api.customers.extras.GET.failed", error);
      return NextResponse.json({ error: "טעינת פרטי לקוח נכשלה" }, { status: 500 });
    }
  });
}
