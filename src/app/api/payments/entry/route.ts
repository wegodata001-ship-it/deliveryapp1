import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { loadPaymentEntryPayload } from "@/lib/payment-entry-payload";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withPerfTimer("api.payments.entry.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const id = (searchParams.get("id") ?? "").trim();
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

      const payload = await loadPaymentEntryPayload(id);
      if (!payload) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

      return NextResponse.json(payload);
    } catch (error) {
      perfError("api.payments.entry.GET.failed", error);
      return NextResponse.json({ error: "טעינת קליטת תשלום נכשלה" }, { status: 500 });
    }
  });
}
