import { PrismaClient } from "@prisma/client";
import { perfEnabled } from "@/lib/perf-log";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPerfSubscribed?: boolean;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: perfEnabled()
      ? [{ level: "query", emit: "event" }, { level: "error", emit: "stdout" }, { level: "warn", emit: "stdout" }]
      : ["error"],
  });

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
