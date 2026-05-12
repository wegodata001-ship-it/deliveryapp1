import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { perfError, withPerfTimer } from "@/lib/perf-log";

export const runtime = "nodejs";

export type CustomerExtrasPayload = {
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
  indexLabel: string | null;
  city: string | null;
  address: string | null;
  balanceUsdDisplay: string;
  balanceUsdNegative: boolean;
};

export async function GET(req: Request) {
  return withPerfTimer("api.customers.extras.GET", async () => {
    try {
      const session = await getSessionPayload();
      if (!session || (session.role !== "ADMIN" && session.role !== "EMPLOYEE")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { searchParams } = new URL(req.url);
      const id = (searchParams.get("id") ?? "").trim();
      if (!id) return NextResponse.json(null);

      const [cust, orderAgg, payAgg] = await Promise.all([
        prisma.customer.findFirst({
          where: { id, deletedAt: null, isActive: true },
          select: {
            nameHe: true,
            nameEn: true,
            nameAr: true,
            phone: true,
            secondPhone: true,
            oldCustomerCode: true,
            customerCode: true,
            city: true,
            address: true,
          },
        }),
        prisma.order.aggregate({
          where: { customerId: id, deletedAt: null },
          _sum: { totalUsd: true },
        }),
        prisma.payment.aggregate({
          where: { customerId: id, isPaid: true },
          _sum: { amountUsd: true },
        }),
      ]);
      if (!cust) return NextResponse.json(null);

      const o = Number(orderAgg._sum.totalUsd ?? 0);
      const p = Number(payAgg._sum.amountUsd ?? 0);
      const bal = o - p;
      const indexLabel = cust.oldCustomerCode?.trim() || cust.customerCode?.trim() || null;

      const payload: CustomerExtrasPayload = {
        nameEn: cust.nameEn ?? cust.nameHe ?? null,
        nameAr: cust.nameAr,
        phone: cust.phone ?? cust.secondPhone,
        indexLabel,
        city: cust.city?.trim() || null,
        address: cust.address?.trim() || null,
        balanceUsdDisplay: bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        balanceUsdNegative: bal < -0.005,
      };
      return NextResponse.json(payload);
    } catch (error) {
      perfError("api.customers.extras.GET.failed", error);
      return NextResponse.json({ error: "טעינת פרטי לקוח נכשלה" }, { status: 500 });
    }
  });
}
