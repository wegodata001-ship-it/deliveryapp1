import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEV_USERNAME = "admin";
const DEV_PASSWORD = "Wego!2026";

async function main() {
  const users = await prisma.user.findMany({
    select: { username: true, email: true, role: true, isActive: true, fullName: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n=== Existing users (${users.length}) ===`);
  for (const u of users) {
    console.log(
      `- ${u.fullName} | username=${u.username ?? "-"} | email=${u.email ?? "-"} | role=${u.role} | active=${u.isActive}`,
    );
  }

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12);
  const existing = await prisma.user.findFirst({ where: { username: DEV_USERNAME } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, isActive: true, role: "ADMIN" },
    });
    console.log(`\n=== Reset dev admin password ===`);
  } else {
    await prisma.user.create({
      data: {
        fullName: "Dev Admin",
        username: DEV_USERNAME,
        passwordHash,
        role: "ADMIN",
        isActive: true,
      },
    });
    console.log(`\n=== Created dev admin ===`);
  }
  console.log(`username: ${DEV_USERNAME}`);
  console.log(`password: ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
