import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { loadPaymentEntryPayload } from "@/lib/payment-entry-payload";
import { resolvePaymentNavigation } from "@/lib/payment-navigation";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET(req: Request) {
  return withPerfTimer("api.payments.navigation.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
      }

      const { searchParams } = new URL(req.url);
      const currentPaymentId = (searchParams.get("currentPaymentId") ?? "").trim();
      const directionRaw = (searchParams.get("direction") ?? "").trim().toLowerCase();
      const includeEntry = searchParams.get("includeEntry") === "1";

      if (!currentPaymentId) {
        return NextResponse.json(
          { success: false, error: "Missing currentPaymentId" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      if (directionRaw !== "prev" && directionRaw !== "next") {
        return NextResponse.json({ error: "direction must be prev or next" }, { status: 400, headers: NO_STORE_HEADERS });
      }

      const result = await resolvePaymentNavigation(currentPaymentId, directionRaw);

      if ("error" in result && result.error === "not_found") {
        return NextResponse.json(
          { success: false as const, error: "Payment not found" },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }
      if (!result.success) {
        return NextResponse.json(result, { headers: NO_STORE_HEADERS });
      }

      const entry = includeEntry ? await loadPaymentEntryPayload(result.paymentId) : null;

      return NextResponse.json({
        success: true as const,
        paymentId: result.paymentId,
        paymentCode: result.paymentCode,
        paymentNumber: result.paymentNumber,
        ...(entry ? { entry } : {}),
      }, { headers: NO_STORE_HEADERS });
    } catch (error) {
      perfError("api.payments.navigation.GET.failed", error);
      return NextResponse.json({ error: "טעינת ניווט תשלומים נכשלה" }, { status: 500, headers: NO_STORE_HEADERS });
    }
  });
}
