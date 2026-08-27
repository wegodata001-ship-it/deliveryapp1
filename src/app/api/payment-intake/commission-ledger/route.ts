import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { buildCustomerCommissionLedger } from "@/lib/customer-commission-ledger";

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

  const ledger = await buildCustomerCommissionLedger(customerId);
  return NextResponse.json(ledger);
}
