import { PrismaClient } from "@prisma/client";
import {
  CLEAR_DEMO_DATA_CONFIRMATION,
  clearDemoData,
  getClearDemoDataPlan,
  isClearDemoConfirmationValid,
} from "../src/lib/clear-demo-data";

const prisma = new PrismaClient();

function readConfirmArg(): string {
  const idx = process.argv.indexOf("--confirm");
  if (idx === -1) return "";
  return process.argv[idx + 1] ?? "";
}

async function main() {
  const plan = await getClearDemoDataPlan(prisma);

  console.log("Clear demo data plan:");
  console.table(plan.counts);
  console.log("Preserved:");
  for (const item of plan.preserved) console.log(`- ${item}`);
  console.log("Counter reset notes:");
  for (const item of plan.resetNotes) console.log(`- ${item}`);

  const confirmation = readConfirmArg();
  if (!isClearDemoConfirmationValid(confirmation)) {
    console.log("");
    console.log(`Dry run only. To delete data, run:`);
    console.log(`tsx scripts/clear-demo-data.ts --confirm "${CLEAR_DEMO_DATA_CONFIRMATION}"`);
    process.exitCode = 1;
    return;
  }

  const result = await clearDemoData(prisma);
  const deletedTotal = Object.values(result.deleted).reduce((sum, n) => sum + n, 0);
  console.log("");
  console.log(`Demo data cleared at ${result.deletedAt} (${deletedTotal} rows deleted)`);
  console.log("Deleted:");
  console.table(result.deleted);
  console.log("Remaining:");
  console.table(result.remaining);
}

main()
  .catch((error) => {
    console.error("clear-demo-data failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
