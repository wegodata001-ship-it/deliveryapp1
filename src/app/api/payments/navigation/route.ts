import { NextResponse } from "next/server";
import { getSessionPayload } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { perfError, withPerfTimer } from "@/lib/perf-log";
import { parsePaymentNumberFromCode } from "@/lib/payment-capture-code";

export const runtime = "nodejs";

type NavDirection = "prev" | "next";

const navSelect = {
  id: true,
  paymentCode: true,
  paymentNumber: true,
} as const;

type NavPaymentRow = {
  id: string;
  paymentCode: string | null;
  paymentNumber: number | null;
};

type NavPaymentCursor = NavPaymentRow | {
  id: string | null;
  paymentCode: string;
  paymentNumber: number;
};

async function findCurrentPaymentEntry(paymentCode: string): Promise<NavPaymentRow | null> {
  const exact = await prisma.payment.findFirst({
    where: {
      paymentCode,
      customerId: { not: null },
    },
    select: navSelect,
  });
  if (exact) return exact;

  const paymentNumber = parsePaymentNumberFromCode(paymentCode);
  if (paymentNumber == null) return null;

  return prisma.payment.findFirst({
    where: {
      paymentNumber,
      customerId: { not: null },
    },
    orderBy: { id: "asc" },
    select: navSelect,
  });
}

async function findNeighborPaymentEntry(
  current: NavPaymentCursor,
  direction: NavDirection,
): Promise<NavPaymentRow | null> {
  if (current.paymentNumber != null) {
    return prisma.payment.findFirst({
      where: {
        customerId: { not: null },
        paymentCode: { not: null },
        paymentNumber: direction === "prev" ? { lt: current.paymentNumber } : { gt: current.paymentNumber },
      },
      orderBy: { paymentNumber: direction === "prev" ? "desc" : "asc" },
      select: navSelect,
    });
  }

  if (!current.id) return null;

  return prisma.payment.findFirst({
    where: {
      customerId: { not: null },
      paymentCode: { not: null },
      id: direction === "prev" ? { lt: current.id } : { gt: current.id },
    },
    orderBy: { id: direction === "prev" ? "desc" : "asc" },
    select: navSelect,
  });
}

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
      const direction = directionRaw as NavDirection;

      const current = await findCurrentPaymentEntry(currentPaymentCode);
      const requestedPaymentNumber = parsePaymentNumberFromCode(currentPaymentCode);
      const currentCursor: NavPaymentCursor | null =
        current ??
        (requestedPaymentNumber == null
          ? null
          : {
              id: null,
              paymentCode: currentPaymentCode,
              paymentNumber: requestedPaymentNumber,
            });

      if (!currentCursor) {
        return NextResponse.json({ success: false as const, error: "Payment not found" }, { status: 404 });
      }

      const row = await findNeighborPaymentEntry(currentCursor, direction);
      if (!row) {
        return NextResponse.json({
          success: false as const,
          edge: direction === "prev" ? ("first" as const) : ("last" as const),
        });
      }

      return NextResponse.json({
        success: true as const,
        paymentId: row.id,
        paymentCode: row.paymentCode ?? null,
        paymentNumber: row.paymentNumber ?? null,
      });
    } catch (error) {
      perfError("api.payments.navigation.GET.failed", error);
      return NextResponse.json({ error: "טעינת ניווט תשלומים נכשלה" }, { status: 500 });
    }
  });
}
