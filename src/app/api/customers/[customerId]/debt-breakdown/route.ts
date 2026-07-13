import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { buildCustomerDebtBreakdown } from "@/lib/customer-debt-breakdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ customerId: string }> },
): Promise<Response> {
  const session = await getSessionPayload();
  if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { customerId } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const country = searchParams.get("country")?.trim() || null;
  const weekCode = searchParams.get("week")?.trim() || searchParams.get("weekCode")?.trim() || null;

  const result = await buildCustomerDebtBreakdown({ customerId, country, weekCode });
  if ("ok" in result && result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json(result);
}
