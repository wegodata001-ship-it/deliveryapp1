import { prisma } from "@/lib/prisma";
import { parsePaymentNumberFromCode } from "@/lib/payment-capture-code";
import { paymentsPerfTimeEnd, paymentsPerfTimeStart } from "@/lib/payments-perf";

export type PaymentNavDirection = "prev" | "next";

const navSelect = {
  id: true,
  paymentCode: true,
  paymentNumber: true,
  customerId: true,
} as const;

export type PaymentNavRow = {
  id: string;
  paymentCode: string | null;
  paymentNumber: number | null;
  customerId: string | null;
};

export type PaymentNavResult =
  | { success: true; paymentId: string; paymentCode: string | null; paymentNumber: number | null }
  | { success: false; edge: "first" | "last" }
  | { success: false; error: "not_found" };

/** שכן לפי מספר רציף — query בודד עם אינדקס paymentNumber */
async function findNeighborByPaymentNumber(
  paymentNumber: number,
  direction: PaymentNavDirection,
): Promise<PaymentNavRow | null> {
  return prisma.payment.findFirst({
    where: {
      customerId: { not: null },
      paymentCode: { not: null },
      paymentNumber: direction === "prev" ? { lt: paymentNumber } : { gt: paymentNumber },
    },
    orderBy: { paymentNumber: direction === "prev" ? "desc" : "asc" },
    select: navSelect,
  });
}

async function findCurrentByCode(paymentCode: string): Promise<PaymentNavRow | null> {
  const exact = await prisma.payment.findUnique({
    where: { paymentCode },
    select: navSelect,
  });
  if (exact?.customerId) return exact;

  const paymentNumber = parsePaymentNumberFromCode(paymentCode);
  if (paymentNumber == null) return null;

  return prisma.payment.findFirst({
    where: { paymentNumber, customerId: { not: null } },
    orderBy: { id: "asc" },
    select: navSelect,
  });
}

async function resolveNeighbor(
  currentPaymentCode: string,
  direction: PaymentNavDirection,
): Promise<PaymentNavResult> {
  const code = currentPaymentCode.trim();
  if (!code) return { success: false, error: "not_found" };

  const parsedNumber = parsePaymentNumberFromCode(code);
  if (parsedNumber != null) {
    const row = await findNeighborByPaymentNumber(parsedNumber, direction);
    if (!row) {
      return { success: false, edge: direction === "prev" ? "first" : "last" };
    }
    return {
      success: true,
      paymentId: row.id,
      paymentCode: row.paymentCode ?? null,
      paymentNumber: row.paymentNumber ?? null,
    };
  }

  const current = await findCurrentByCode(code);
  if (!current) return { success: false, error: "not_found" };

  if (current.paymentNumber != null) {
    const row = await findNeighborByPaymentNumber(current.paymentNumber, direction);
    if (!row) {
      return { success: false, edge: direction === "prev" ? "first" : "last" };
    }
    return {
      success: true,
      paymentId: row.id,
      paymentCode: row.paymentCode ?? null,
      paymentNumber: row.paymentNumber ?? null,
    };
  }

  if (!current.id) return { success: false, error: "not_found" };

  const row = await prisma.payment.findFirst({
    where: {
      customerId: { not: null },
      paymentCode: { not: null },
      id: direction === "prev" ? { lt: current.id } : { gt: current.id },
    },
    orderBy: { id: direction === "prev" ? "desc" : "asc" },
    select: navSelect,
  });

  if (!row) {
    return { success: false, edge: direction === "prev" ? "first" : "last" };
  }

  return {
    success: true,
    paymentId: row.id,
    paymentCode: row.paymentCode ?? null,
    paymentNumber: row.paymentNumber ?? null,
  };
}

export async function resolvePaymentNavigation(
  currentPaymentCode: string,
  direction: PaymentNavDirection,
): Promise<PaymentNavResult> {
  paymentsPerfTimeStart("payments.navigation.db");
  try {
    return await resolveNeighbor(currentPaymentCode, direction);
  } finally {
    paymentsPerfTimeEnd("payments.navigation.db");
  }
}
