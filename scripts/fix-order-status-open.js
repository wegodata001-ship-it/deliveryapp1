const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const sql =
      'UPDATE "Order" SET "status" = \'OPEN\' WHERE "status" IS NULL OR BTRIM("status") = \'\'';
    const res = await prisma.$executeRawUnsafe(sql);
    console.log("fixed orders status rows:", res);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

