import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { buildCustomerCreditLedger } from "@/lib/customer-credit-balance";
import { openDebtScopeForWorkCountry } from "@/lib/customer-open-debt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSessionPayload();
  if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const customerId = (searchParams.get("customerId") ?? "").trim();
  const country = searchParams.get("country")?.trim() || null;
  if (!customerId) return NextResponse.json({ error: "Missing customerId" }, { status: 400 });

  const ledger = await buildCustomerCreditLedger(customerId, openDebtScopeForWorkCountry(country));
  return NextResponse.json({ ok: true, ...ledger });
}
