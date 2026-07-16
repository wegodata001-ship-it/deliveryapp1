/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function numDec(v) {
  if (v == null) return 0;
  return Number(v.toString());
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const customerCode = process.argv[2] || "105";
  const c = await prisma.customer.findFirst({
    where: { customerCode },
    select: { id: true, customerCode: true, displayName: true, balanceUsd: true },
  });
  if (!c) {
    console.log("customer not found", { customerCode });
    return;
  }
  console.log("customer", {
    id: c.id,
    customerCode: c.customerCode,
    displayName: c.displayName,
    balanceUsd: c.balanceUsd ? c.balanceUsd.toString() : null,
  });

  const pays = await prisma.payment.findMany({
    where: { customerId: c.id, status: { not: "CANCELLED" }, isPaid: true },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    take: 25,
    select: {
      id: true,
      paymentCode: true,
      paymentNumber: true,
      orderId: true,
      amountUsd: true,
      notes: true,
      paymentDate: true,
      createdAt: true,
    },
  });
  console.log("recent payments (25):");
  for (const p of pays) {
    const note = (p.notes || "").split("\n")[0];
    console.log({
      id: p.id,
      code: p.paymentCode,
      num: p.paymentNumber,
      orderId: p.orderId,
      usd: p.amountUsd ? p.amountUsd.toString() : null,
      date: p.paymentDate,
      created: p.createdAt,
      note,
    });
  }

  const orders = await prisma.order.findMany({
    where: { customerId: c.id, deletedAt: null, status: { not: "DEBT_WITHDRAWAL" } },
    orderBy: [{ orderDate: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: { id: true, orderNumber: true, totalUsd: true, amountUsd: true, commissionUsd: true },
  });
  const orderIds = orders.map((o) => o.id);
  const sums =
    orderIds.length > 0
      ? await prisma.payment.groupBy({
          by: ["orderId"],
          where: {
            orderId: { in: orderIds },
            amountUsd: { not: null },
            isPaid: true,
            status: { not: "CANCELLED" },
          },
          _sum: { amountUsd: true },
        })
      : [];
  const paidBy = new Map(sums.filter((s) => s.orderId).map((s) => [s.orderId, numDec(s._sum.amountUsd)]));

  const open = [];
  for (const o of orders) {
    const totalUsd = numDec(o.totalUsd) || numDec(o.amountUsd) + numDec(o.commissionUsd);
    const paidUsd = paidBy.get(o.id) || 0;
    const remainingUsd = round2(Math.max(0, totalUsd - paidUsd));
    if (remainingUsd > 0.01) {
      open.push({
        orderNumber: o.orderNumber,
        orderId: o.id,
        totalUsd: round2(totalUsd),
        paidUsd: round2(paidUsd),
        remainingUsd,
      });
    }
  }
  console.log("open orders (remaining>0.01):", open.slice(0, 50));
  console.log("open orders count:", open.length);
}

main()
  .catch((e) => {
    console.error("failed", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

