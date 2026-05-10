import { NextResponse } from "next/server";
import { getCurrentUser, userHasAnyPermission } from "@/lib/admin-auth";
import { searchCustomersByQueryPaged } from "@/lib/customer-api-search";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import { warnIfMissingCriticalEnv } from "@/lib/env-check";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withPerfTimer("api.customers.GET", async () => {
    try {
      warnIfMissingCriticalEnv();
      const me = await getCurrentUser();
      if (!me || !userHasAnyPermission(me, ["create_orders", "edit_orders", "receive_payments"])) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const query = (searchParams.get("query") ?? "").trim();
      const limitRaw = Number(searchParams.get("limit") ?? "20");
      const pageRaw = Number(searchParams.get("page") ?? "1");

      const customers = await searchCustomersByQueryPaged({
        query,
        limit: Number.isFinite(limitRaw) ? limitRaw : 20,
        page: Number.isFinite(pageRaw) ? pageRaw : 1,
      });
      return NextResponse.json({ customers });
    } catch (error) {
      perfError("api.customers.GET.failed", error);
      return NextResponse.json({ error: "טעינת נתונים נכשלה" }, { status: 500 });
    }
  });
}
