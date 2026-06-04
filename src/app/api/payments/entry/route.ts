import { NextResponse } from "next/server";
import { logDbEnvDiagnostics } from "@/lib/db-env-diagnostics";
import { getSessionPayload } from "@/lib/admin-auth";
import { loadPaymentEntryPayload } from "@/lib/payment-entry-payload";
import { getPaymentNavigationLinks } from "@/lib/payment-navigation";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET(req: Request) {
  logDbEnvDiagnostics("GET /api/payments/entry");
  return withPerfTimer("api.payments.entry.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
      }

      const { searchParams } = new URL(req.url);
      const id = (searchParams.get("id") ?? "").trim();
      if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400, headers: NO_STORE_HEADERS });

      const payload = await loadPaymentEntryPayload(id);
      if (!payload) {
        return NextResponse.json({ error: "Payment not found" }, { status: 404, headers: NO_STORE_HEADERS });
      }

      const links = await getPaymentNavigationLinks(payload.id);
      const navigation = links ?? {
        currentPaymentId: payload.id,
        currentPaymentCode: payload.paymentCode,
        currentPaymentNumber: payload.paymentNumber,
        previousPaymentId: null,
        nextPaymentId: null,
      };

      return NextResponse.json(
        {
          ...payload,
          navigation,
        },
        { headers: NO_STORE_HEADERS },
      );
    } catch (error) {
      perfError("api.payments.entry.GET.failed", error);
      return NextResponse.json(
        { error: "טעינת קליטת תשלום נכשלה" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
  });
}
