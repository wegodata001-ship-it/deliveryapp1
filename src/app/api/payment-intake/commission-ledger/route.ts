import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { buildCustomerCommissionLedger } from "@/lib/customer-commission-ledger";
import { historicalCustomerFinancialScope, toCustomerBalanceCalcScope } from "@/lib/customer-financial-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSessionPayload();
  if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const customerId = (searchParams.get("customerId") ?? "").trim();
  if (!customerId) return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
  const toYmd = (searchParams.get("toYmd") ?? "").trim();
  const scope = toYmd
    ? toCustomerBalanceCalcScope(historicalCustomerFinancialScope({ cutoffYmd: toYmd }))
    : {};

  const ledger = await buildCustomerCommissionLedger(customerId, scope);
  return NextResponse.json(ledger);
}
