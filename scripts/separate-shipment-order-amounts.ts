import { prisma } from "@/lib/prisma";

async function main() {
  const importedRows = await prisma.shipmentRecord.findMany({
    where: {
      orderAmount: null,
      deliveryFeeAmount: { not: null },
      OR: [
        { customerCode: { not: null } },
        { cartonDetails: { not: null } },
      ],
    },
    select: {
      id: true,
      deliveryFeeAmount: true,
      deliveryFeeCurrency: true,
      _count: { select: { payments: true } },
    },
  });

  let separated = 0;
  let preservedHistoricalFee = 0;
  for (const row of importedRows) {
    const hasPayments = row._count.payments > 0;
    await prisma.shipmentRecord.update({
      where: { id: row.id },
      data: {
        orderAmount: row.deliveryFeeAmount,
        orderCurrency: row.deliveryFeeCurrency,
        ...(!hasPayments
          ? {
              deliveryFeeAmount: null,
              deliveryFeeCurrency: "ILS",
              deliveryFeeIls: null,
              paymentStatus: "UNPAID",
            }
          : {}),
      },
    });
    separated += 1;
    if (hasPayments) preservedHistoricalFee += 1;
  }

  console.log(JSON.stringify({ separated, preservedHistoricalFee }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
