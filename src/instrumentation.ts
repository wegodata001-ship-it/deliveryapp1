export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmPrismaConnection } = await import("@/lib/prisma");
    await warmPrismaConnection();
  }
}
