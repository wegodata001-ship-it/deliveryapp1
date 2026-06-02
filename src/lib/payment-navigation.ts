import { prisma } from "@/lib/prisma";
import { paymentsPerfTimeEnd, paymentsPerfTimeStart } from "@/lib/payments-perf";
import type { Prisma } from "@prisma/client";

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

export type PreviousPaymentResult = {
  previousPaymentId: string | null;
  previousPaymentCode: string | null;
  previousPaymentNumber: number | null;
};

export type NextPaymentResult = {
  nextPaymentId: string | null;
  nextPaymentCode: string | null;
  nextPaymentNumber: number | null;
};

const paymentNavigationOrder = [{ createdAt: "desc" as const }, { id: "desc" as const }];

async function findCurrentById(currentPaymentId: string) {
  const id = currentPaymentId.trim();
  if (!id) return null;
  return prisma.payment.findFirst({
    where: { id, customerId: { not: null }, paymentCode: { not: null } },
    select: { ...navSelect, createdAt: true },
  });
}

async function findNeighborByCreatedAt(
  current: NonNullable<Awaited<ReturnType<typeof findCurrentById>>>,
  direction: PaymentNavDirection,
): Promise<PaymentNavRow | null> {
  const createdAtTie =
    direction === "prev"
      ? ({ lt: current.id } satisfies Prisma.StringFilter<"Payment">)
      : ({ gt: current.id } satisfies Prisma.StringFilter<"Payment">);
  const createdAtWhere =
    direction === "prev"
      ? ({ lt: current.createdAt } satisfies Prisma.DateTimeFilter<"Payment">)
      : ({ gt: current.createdAt } satisfies Prisma.DateTimeFilter<"Payment">);

  return prisma.payment.findFirst({
    where: {
      customerId: { not: null },
      paymentCode: { not: null },
      OR: [{ createdAt: createdAtWhere }, { createdAt: current.createdAt, id: createdAtTie }],
    },
    orderBy: direction === "prev" ? paymentNavigationOrder : [{ createdAt: "asc" }, { id: "asc" }],
    select: navSelect,
  });
}

export async function getPreviousPayment(currentPaymentId: string): Promise<PreviousPaymentResult> {
  const current = await findCurrentById(currentPaymentId);
  if (!current) {
    return { previousPaymentId: null, previousPaymentCode: null, previousPaymentNumber: null };
  }

  const row = await findNeighborByCreatedAt(current, "prev");
  return {
    previousPaymentId: row?.id ?? null,
    previousPaymentCode: row?.paymentCode ?? null,
    previousPaymentNumber: row?.paymentNumber ?? null,
  };
}

export async function getNextPayment(currentPaymentId: string): Promise<NextPaymentResult> {
  const current = await findCurrentById(currentPaymentId);
  if (!current) {
    return { nextPaymentId: null, nextPaymentCode: null, nextPaymentNumber: null };
  }

  const row = await findNeighborByCreatedAt(current, "next");
  return {
    nextPaymentId: row?.id ?? null,
    nextPaymentCode: row?.paymentCode ?? null,
    nextPaymentNumber: row?.paymentNumber ?? null,
  };
}

export async function resolvePaymentNavigation(
  currentPaymentId: string,
  direction: PaymentNavDirection,
): Promise<PaymentNavResult> {
  paymentsPerfTimeStart("payments.navigation.db");
  try {
    const current = await findCurrentById(currentPaymentId);
    if (!current) return { success: false, error: "not_found" };

    if (direction === "prev") {
      const result = await getPreviousPayment(currentPaymentId);
      if (!result.previousPaymentId) return { success: false, edge: "first" };
      return {
        success: true,
        paymentId: result.previousPaymentId,
        paymentCode: result.previousPaymentCode,
        paymentNumber: result.previousPaymentNumber,
      };
    }

    const result = await getNextPayment(currentPaymentId);
    if (!result.nextPaymentId) return { success: false, edge: "last" };
    return {
      success: true,
      paymentId: result.nextPaymentId,
      paymentCode: result.nextPaymentCode,
      paymentNumber: result.nextPaymentNumber,
    };
  } finally {
    paymentsPerfTimeEnd("payments.navigation.db");
  }
}
