import { NextResponse } from "next/server";
import { getCurrentUser, userHasAnyPermission } from "@/lib/admin-auth";
import { searchCustomersByQuery } from "@/lib/customer-api-search";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me || !userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("query") ?? "").trim();

  const customers = await searchCustomersByQuery(query);
  return NextResponse.json({ customers });
}
