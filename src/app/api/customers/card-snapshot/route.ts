import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { getCachedCustomerCardSnapshot } from "@/lib/customer-card-snapshot-cache";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

const VIEW_KEYS = ["view_customer_card", "view_customers", "create_orders", "edit_orders"] as const;

function sessionCanViewCustomerCard(session: { role: string; perms?: string[] }): boolean {
  if (session.role === "ADMIN") return true;
  const perms = session.perms ?? [];
  return VIEW_KEYS.some((k) => perms.includes(k));
}

export async function GET(req: Request) {
  return withPerfTimer("api.customers.card-snapshot.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!sessionCanViewCustomerCard(session)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const id = new URL(req.url).searchParams.get("id")?.trim() ?? "";
      if (!id) return NextResponse.json(null);

      const snap = await getCachedCustomerCardSnapshot(id);
      return NextResponse.json(snap);
    } catch (error) {
      perfError("api.customers.card-snapshot.GET.failed", error);
      return NextResponse.json({ error: "טעינת כרטסת נכשלה" }, { status: 500 });
    }
  });
}
