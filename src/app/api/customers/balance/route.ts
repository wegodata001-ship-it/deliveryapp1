import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export type CustomerBalancePayload = {
  balanceUsdDisplay: string;
  balanceUsdNegative: boolean;
};

export async function GET(req: Request) {
  return withPerfTimer("api.customers.balance.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const id = (searchParams.get("id") ?? "").trim();
      if (!id) return NextResponse.json(null);

      const [orderAgg, payAgg] = await Promise.all([
        prisma.order.aggregate({
          where: { customerId: id, deletedAt: null },
          _sum: { totalUsd: true },
        }),
        prisma.payment.aggregate({
          where: { customerId: id, isPaid: true },
          _sum: { amountUsd: true },
        }),
      ]);

      const o = Number(orderAgg._sum.totalUsd ?? 0);
      const p = Number(payAgg._sum.amountUsd ?? 0);
      const bal = o - p;

      const payload: CustomerBalancePayload = {
        balanceUsdDisplay: bal.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        balanceUsdNegative: bal < -0.005,
      };
      return NextResponse.json(payload);
    } catch (error) {
      perfError("api.customers.balance.GET.failed", error);
      return NextResponse.json({ error: "טעינת יתרה נכשלה" }, { status: 500 });
    }
  });
}
