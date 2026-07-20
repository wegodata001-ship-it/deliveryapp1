import { prisma } from "@/lib/prisma";

const ids = [
  "e041b5c2-f466-4ad1-b54f-59c40e11b16e",
  "9d3d6b80-9a42-41ee-a277-3ab015fc3503",
  "cc5c1077-4ba3-48d0-9370-3058863e782a",
];
const paymentIds = [
  "218f6d46-d394-4b89-b632-f72bb0037715",
  "77f6bd0f-2d21-4ec5-8749-4a85ea582d27",
  "87726dd1-7df4-4bb4-be1b-3a44aa4a3337",
  "1d7ed23c-f486-43d5-960b-59a3ee86172e",
  "a9be24a5-e633-4f7d-83a1-97e3d94623c8",
];

async function main() {
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityId: { in: [...ids, ...paymentIds] } },
        {
          AND: [
            { createdAt: { gte: new Date("2026-07-19T00:00:00Z") } },
            { createdAt: { lte: new Date("2026-07-20T23:59:59Z") } },
            {
              OR: [
                { actionType: { contains: "PAYMENT" } },
                { actionType: { contains: "BREAKDOWN" } },
                { actionType: { contains: "DEBT" } },
                { actionType: { contains: "MATCH" } },
              ],
            },
          ],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      actionType: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      metadata: true,
    },
    take: 100,
  });
  console.log(JSON.stringify(logs, null, 2));

  // Confirm all breakdown updatedAt identical (migration fingerprint)
  const bd = await prisma.orderPaymentBreakdown.findMany({
    where: { orderId: { in: ids } },
    select: { orderId: true, id: true, updatedAt: true, paidAmount: true, remainingAmount: true },
  });
  console.log("\nBREAKDOWN updatedAt fingerprint:");
  console.log(JSON.stringify(bd, null, 2));

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
