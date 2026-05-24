import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { searchCustomersPrisma } from "@/lib/customer-search-prisma";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withPerfTimer("api.customers.search-fast.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const q = (searchParams.get("q") ?? "").trim();
      const exactOnly = searchParams.get("exact") === "1";

      const rows = await searchCustomersPrisma(q, { limit: exactOnly ? 1 : 20, exactOnly });
      return NextResponse.json(exactOnly ? rows[0] ?? null : rows);
    } catch (error) {
      perfError("api.customers.search-fast.GET.failed", error);
      return NextResponse.json({ error: "טעינת לקוחות נכשלה" }, { status: 500 });
    }
  });
}
