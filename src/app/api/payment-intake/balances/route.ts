import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { loadPaymentIntakeBalancesForCustomer } from "@/lib/payment-intake-load";

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

  const res = await loadPaymentIntakeBalancesForCustomer({
    customerId,
    paymentWorkCountryRaw: country,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 404 });
  return NextResponse.json(res);
}
