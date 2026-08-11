import "server-only";

import { PrismaClient } from "@prisma/client";
import { logDbEnvDiagnostics } from "@/lib/db-env-diagnostics";
import { applyPrismaDatabaseUrlDefaults, isPrismaConnectionError } from "@/lib/prisma-connection-url";
import { perfEnabled } from "@/lib/perf-log";

applyPrismaDatabaseUrlDefaults();

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
  const base = new PrismaClient({
    log: perfEnabled()
      ? [{ level: "query", emit: "event" }, { level: "error", emit: "stdout" }, { level: "warn", emit: "stdout" }]
      : ["error"],
  });

  if (typeof window === "undefined" && perfEnabled() && !globalForPrisma.prismaPerfSubscribed) {
    globalForPrisma.prismaPerfSubscribed = true;
    base.$on("query", (event) => {
      const slow = event.duration >= 350;
      if (!slow && process.env.DEBUG_PERF_LOGS !== "verbose") return;
      console.error("[perf] prisma.query", {
        durationMs: event.duration,
        target: event.target,
        query: event.query.slice(0, 280),
      });
    });
  }

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          try {
            return await query(args);
          } catch (error) {
            if (!isPrismaConnectionError(error)) throw error;
            await base.$connect();
            return await query(args);
          }
        },
      },
    },
  }) as unknown as PrismaClient;
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

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Warm-up — קורא מ-instrumentation.ts בהפעלת השרת */
export async function warmPrismaConnection(): Promise<void> {
  try {
    await prisma.$connect();
  } catch {
    // retry once after pooler reset
    await prisma.$connect().catch(() => {});
  }
}
