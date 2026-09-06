import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export type CustomerBalancePayload = {
  balanceUsdDisplay: string;
  balanceUsdNegative: boolean;
  openDebtUsd: number;
  customerCreditUsd: number;
  feeBalanceUsd: number;
  financialStatus: "DEBT" | "BALANCED" | "CREDIT";
};

export async function GET(req: Request) {
  return withPerfTimer("api.customers.balance.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const id = (searchParams.get("id") ?? "").trim();
      if (!id) return NextResponse.json(null);

      const country = searchParams.get("country");
      const { openDebtScopeForWorkCountry } = await import("@/lib/customer-open-debt");
      const { getCustomerAccountBalances, financialStateFromAccounts } = await import(
        "@/lib/customer-account-balances"
      );
      const accounts = await getCustomerAccountBalances(id, openDebtScopeForWorkCountry(country));
      const state = financialStateFromAccounts(accounts);

      const payload: CustomerBalancePayload = {
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
      perfError("api.customers.balance.GET.failed", error);
      return NextResponse.json({ error: "טעינת יתרה נכשלה" }, { status: 500 });
    }
  });
}
