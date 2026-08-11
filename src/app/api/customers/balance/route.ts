import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export type CustomerBalancePayload = {
  balanceUsdDisplay: string;
  balanceUsdNegative: boolean;
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
      const { getCustomerOpenDebt, openDebtScopeForWorkCountry } = await import("@/lib/customer-open-debt");
      const debt = await getCustomerOpenDebt(id, openDebtScopeForWorkCountry(country));
      const businessSigned = Number(debt.signedBalanceUsd.toFixed(2));

      const payload: CustomerBalancePayload = {
        balanceUsdDisplay: businessSigned.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        balanceUsdNegative: businessSigned < -0.005,
      };
      return NextResponse.json(payload);
    } catch (error) {
      perfError("api.customers.balance.GET.failed", error);
      return NextResponse.json({ error: "טעינת יתרה נכשלה" }, { status: 500 });
    }
  });
}
