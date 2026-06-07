import { prisma } from "@/lib/prisma";
import { paymentsPerfTimeEnd, paymentsPerfTimeStart } from "@/lib/payments-perf";

const navSelect = {
  id: true,
  paymentCode: true,
  paymentNumber: true,
} as const;

/** קליטה ראשית — שורה עם paymentCode */
const PRIMARY_CAPTURE_WHERE = {
  paymentCode: { not: null },
  customerId: { not: null },
  paymentNumber: { not: null },
} as const;

/** מפתח מיון ERP: paymentDate → createdAt → paymentNumber → id */
type PaymentNavAnchor = {
  id: string;
  paymentDate: Date;
  createdAt: Date;
  paymentNumber: number;
};

export type PaymentNavigationLinks = {
  currentPaymentId: string;
  currentPaymentCode: string | null;
  currentPaymentNumber: number | null;
  previousPaymentId: string | null;
  nextPaymentId: string | null;
};

function anchorFromRow(row: {
  id: string;
  paymentDate: Date | null;
  createdAt: Date;
  paymentNumber: number | null;
  paymentCode?: string | null;
}): PaymentNavAnchor | null {
  const n = row.paymentNumber;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return null;
  return {
    id: row.id,
    paymentDate: row.paymentDate ?? row.createdAt,
    createdAt: row.createdAt,
    paymentNumber: n,
  };
}

function whereBeforeAnchor(anchor: PaymentNavAnchor) {
  const { paymentDate: pd, createdAt: ca, paymentNumber: pn, id } = anchor;
  return {
    OR: [
      { paymentDate: { lt: pd } },
      { paymentDate: pd, createdAt: { lt: ca } },
      { paymentDate: pd, createdAt: ca, paymentNumber: { lt: pn } },
      { paymentDate: pd, createdAt: ca, paymentNumber: pn, id: { lt: id } },
    ],
  };
}

function whereAfterAnchor(anchor: PaymentNavAnchor) {
  const { paymentDate: pd, createdAt: ca, paymentNumber: pn, id } = anchor;
  return {
    OR: [
      { paymentDate: { gt: pd } },
      { paymentDate: pd, createdAt: { gt: ca } },
      { paymentDate: pd, createdAt: ca, paymentNumber: { gt: pn } },
      { paymentDate: pd, createdAt: ca, paymentNumber: pn, id: { gt: id } },
    ],
  };
}

async function resolveNavigationAnchor(currentPaymentId: string): Promise<PaymentNavAnchor | null> {
  const trimmed = currentPaymentId.trim();
  if (!trimmed) return null;

  const current = await prisma.payment.findFirst({
    where: { id: trimmed },
    select: {
      id: true,
      paymentNumber: true,
      paymentCode: true,
      customerId: true,
      paymentDate: true,
      createdAt: true,
    },
  });
  if (!current?.customerId) return null;

  if (current.paymentCode) {
    return anchorFromRow(current);
  }

  const n = current.paymentNumber;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return null;

  const primary = await prisma.payment.findFirst({
    where: {
      ...PRIMARY_CAPTURE_WHERE,
      paymentNumber: n,
    },
    select: {
      id: true,
      paymentNumber: true,
      paymentDate: true,
      createdAt: true,
      paymentCode: true,
    },
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  if (!primary) return null;
  return anchorFromRow(primary);
}

/**
 * שכנות ניווט לקליטה נוכחית — שאילתות prev/next ייעודיות (paymentDate, createdAt, paymentNumber).
 */
export async function getPaymentNavigationLinks(
  currentPaymentId: string,
): Promise<PaymentNavigationLinks | null> {
  const totalStart = Date.now();
  paymentsPerfTimeStart("payments.navigation.db");
  try {
    const anchorStart = Date.now();
    const anchor = await resolveNavigationAnchor(currentPaymentId);
    const resolveAnchorMs = Date.now() - anchorStart;
    if (!anchor) return null;

    const currentRow = await prisma.payment.findFirst({
      where: { id: anchor.id },
      select: navSelect,
    });

    const prevNextStart = Date.now();
    const [prevRow, nextRow] = await Promise.all([
      prisma.payment.findFirst({
        where: {
          ...PRIMARY_CAPTURE_WHERE,
          ...whereBeforeAnchor(anchor),
        },
        orderBy: [
          { paymentDate: "desc" },
          { createdAt: "desc" },
          { paymentNumber: "desc" },
          { id: "desc" },
        ],
        select: navSelect,
      }),
      prisma.payment.findFirst({
        where: {
          ...PRIMARY_CAPTURE_WHERE,
          ...whereAfterAnchor(anchor),
        },
        orderBy: [
          { paymentDate: "asc" },
          { createdAt: "asc" },
          { paymentNumber: "asc" },
          { id: "asc" },
        ],
        select: navSelect,
      }),
    ]);
    const prevNextMs = Date.now() - prevNextStart;

    const result = {
      currentPaymentId: anchor.id,
      currentPaymentCode: currentRow?.paymentCode ?? null,
      currentPaymentNumber: currentRow?.paymentNumber ?? anchor.paymentNumber,
      previousPaymentId: prevRow?.id ?? null,
      nextPaymentId: nextRow?.id ?? null,
    };

    console.log("payments.navigation.db breakdown", {
      navigationQueryMs: Date.now() - totalStart,
      resolveAnchorMs,
      prevNextMs,
      note: "prev/next scan all capture payments (no customerId filter)",
    });

    return result;
  } finally {
    paymentsPerfTimeEnd("payments.navigation.db");
  }
}
