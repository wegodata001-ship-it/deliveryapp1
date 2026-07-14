import { PrismaClient } from "@prisma/client";
import { logDbEnvDiagnostics } from "@/lib/db-env-diagnostics";
import { perfEnabled } from "@/lib/perf-log";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPerfSubscribed?: boolean;
};

const PRISMA_INSTANCE_ID = "wego-app-singleton";

function prismaClientHasRequiredDelegates(client: PrismaClient): boolean {
  const c = client as PrismaClient & {
    turkeyTransferMovement?: { findMany?: unknown };
    paymentPlan?: { findMany?: unknown };
    paymentAdjustmentFee?: { findMany?: unknown };
  };
  return (
    typeof c.turkeyTransferMovement?.findMany === "function" &&
    typeof c.paymentPlan?.findMany === "function" &&
    typeof c.paymentAdjustmentFee?.findMany === "function"
  );
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: perfEnabled()
      ? [{ level: "query", emit: "event" }, { level: "error", emit: "stdout" }, { level: "warn", emit: "stdout" }]
      : ["error"],
  });
}

// Next dev caches the module singleton — recreate after `prisma generate` adds new models.
if (globalForPrisma.prisma && !prismaClientHasRequiredDelegates(globalForPrisma.prisma)) {
  void globalForPrisma.prisma.$disconnect().catch(() => {});
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (typeof window === "undefined") {
  logDbEnvDiagnostics("prisma:init", PRISMA_INSTANCE_ID);
}

if (typeof window === "undefined" && perfEnabled() && !globalForPrisma.prismaPerfSubscribed) {
  globalForPrisma.prismaPerfSubscribed = true;
  (prisma as PrismaClient & {
    $on: (eventType: "query", callback: (event: { duration: number; target: string; query: string }) => void) => void;
  }).$on("query", (event) => {
    const slow = event.duration >= 350;
    if (!slow && process.env.DEBUG_PERF_LOGS !== "verbose") return;
    console.error("[perf] prisma.query", {
      durationMs: event.duration,
      target: event.target,
      query: event.query.slice(0, 280),
    });
  });
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
