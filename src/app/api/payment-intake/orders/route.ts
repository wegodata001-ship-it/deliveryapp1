import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { loadPaymentIntakeOrdersForCustomer } from "@/lib/payment-intake-load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSessionPayload();
  if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const customerId = (searchParams.get("customerId") ?? "").trim();
  const week = searchParams.get("week")?.trim() || null;
  const country = searchParams.get("country")?.trim() || null;
  if (!customerId) return NextResponse.json({ error: "Missing customerId" }, { status: 400 });

  try {
    const res = await loadPaymentIntakeOrdersForCustomer({
      customerId,
      weekCodeForOpenBalances: week,
      paymentWorkCountryRaw: country,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 404 });
    return NextResponse.json(res);
  } catch (err) {
  console.error("[payment-intake/orders]", err);
  const message = err instanceof Error ? err.message : "טעינת הזמנות נכשלה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
