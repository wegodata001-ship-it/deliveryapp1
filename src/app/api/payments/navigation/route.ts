import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { resolvePaymentNavigation } from "@/lib/payment-navigation";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withPerfTimer("api.payments.navigation.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const currentPaymentCode = (searchParams.get("currentPaymentCode") ?? "").trim();
      const directionRaw = (searchParams.get("direction") ?? "").trim().toLowerCase();

      if (!currentPaymentCode) {
        return NextResponse.json({ success: false, error: "Missing currentPaymentCode" }, { status: 400 });
      }
      if (directionRaw !== "prev" && directionRaw !== "next") {
        return NextResponse.json({ error: "direction must be prev or next" }, { status: 400 });
      }

      const result = await resolvePaymentNavigation(currentPaymentCode, directionRaw);

      if ("error" in result && result.error === "not_found") {
        return NextResponse.json({ success: false as const, error: "Payment not found" }, { status: 404 });
      }
      if (!result.success) {
        return NextResponse.json(result);
      }

      return NextResponse.json({
        success: true as const,
        paymentId: result.paymentId,
        paymentCode: result.paymentCode,
        paymentNumber: result.paymentNumber,
      });
    } catch (error) {
      perfError("api.payments.navigation.GET.failed", error);
      return NextResponse.json({ error: "טעינת ניווט תשלומים נכשלה" }, { status: 500 });
    }
  });
}
