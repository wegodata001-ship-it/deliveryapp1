/**
 * מוודא שכל מפתחות ההרשאות קיימים ופעילים ב-DB.
 * הרצה: npx tsx scripts/ensure-permissions.ts
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

import { PrismaClient } from "@prisma/client";
import { APP_PERMISSION_DEFINITIONS, ensureAppPermissions } from "../src/lib/permissions";

const prisma = new PrismaClient();

async function main() {
  await ensureAppPermissions(prisma);
  const rows = await prisma.permission.findMany({
    where: { key: { in: APP_PERMISSION_DEFINITIONS.map((p) => p.key) } },
    select: { key: true, isActive: true, name: true },
    orderBy: { key: "asc" },
  });
  console.log(`OK — ${rows.length} הרשאות פעילות במסד:`);
  for (const r of rows) {
    console.log(`  ${r.isActive ? "✓" : "✗"} ${r.key} — ${r.name}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
