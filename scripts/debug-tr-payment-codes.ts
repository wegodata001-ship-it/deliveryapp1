import { PrismaClient } from "@prisma/client";
import { listCapturePaymentCodesOrdered } from "../src/lib/payment-code-navigation";

const prisma = new PrismaClient();

async function main() {
  const allTr = await prisma.$queryRaw<
    Array<{ paymentCode: string | null; customerId: string | null; id: string }>
  >`
    SELECT "paymentCode", "customerId", "id"
    FROM "Payment"
    WHERE "paymentCode" ILIKE 'TR-P-%' OR "paymentCode" ILIKE 'WGP-P-%'
    ORDER BY "paymentCode" ASC
  `;

  console.log("=== All TR-P / WGP-P in Payment table ===");
  console.table(allTr);

  const navList = await listCapturePaymentCodesOrdered("TR");
  console.log("\n=== listCapturePaymentCodesOrdered(TR) — used by arrows ===");
  console.log(navList);
  console.log("count:", navList.length);

  const idx2 = navList.indexOf("TR-P-000002");
  console.log("\nindexOf TR-P-000002:", idx2);
  console.log("has TR-P-000001:", navList.includes("TR-P-000001"));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
