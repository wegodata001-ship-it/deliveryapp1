import { getSessionPayload } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { isNextNavigationError, perfError } from "@/lib/perf-log";

function formatAdminLoadError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause instanceof Error ? error.cause.message : error.cause,
    };
  }
  return { raw: String(error) };
}

function adminLoadDiagnosticsEnabled(): boolean {
  return process.env.DEBUG_ADMIN_LOAD === "1" || process.env.DEBUG_ADMIN_LOAD === "true";
}

/** לוג אבחון — רק כש-DEBUG_ADMIN_LOAD=1 (לא ב-hot path) */
export async function logAdminLoadDiagnostics(phase: string): Promise<void> {
  if (!adminLoadDiagnosticsEnabled()) return;
  try {
    const session = await getSessionPayload();
    let userRow: { id: string; username: string | null; role: string; isActive: boolean } | null = null;
    if (session?.sub) {
      userRow = await prisma.user.findUnique({
        where: { id: session.sub },
        select: { id: true, username: true, role: true, isActive: true },
      });
    }

    const hasSessionSecret = !!(process.env.SESSION_SECRET?.trim() && process.env.SESSION_SECRET.trim().length >= 16);

    console.log("[ADMIN LOAD]", phase, {
      sessionUserId: session?.sub ?? null,
      sessionName: session?.name ?? null,
      sessionRole: session?.role ?? null,
      dbUserExists: !!userRow,
      dbUsername: userRow?.username ?? null,
      dbIsActive: userRow?.isActive ?? null,
      hasSessionSecret,
      nodeEnv: process.env.NODE_ENV,
    });

    const counts = await Promise.all([
      prisma.order.count({ where: { deletedAt: null } }).catch((e) => ({ err: e })),
      prisma.payment.count().catch((e) => ({ err: e })),
      prisma.customer.count({ where: { deletedAt: null } }).catch((e) => ({ err: e })),
    ]);

    const orderCount = typeof counts[0] === "number" ? counts[0] : null;
    const paymentCount = typeof counts[1] === "number" ? counts[1] : null;
    const customerCount = typeof counts[2] === "number" ? counts[2] : null;

    console.log("[ADMIN LOAD] counts", {
      orders: orderCount,
      payments: paymentCount,
      customers: customerCount,
      orderCountError: orderCount === null ? formatAdminLoadError((counts[0] as { err: unknown }).err) : null,
      paymentCountError: paymentCount === null ? formatAdminLoadError((counts[1] as { err: unknown }).err) : null,
    });
  } catch (error) {
    console.error("[ADMIN LOAD] diagnostics failed", formatAdminLoadError(error));
  }
}

/** עוטף טעינת admin — מדפיס stack מלא; לא בולע redirect של Next */
export async function runAdminLoadSafe<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isNextNavigationError(error)) throw error;
    console.error("[ADMIN LOAD ERROR]", { label, ...formatAdminLoadError(error) });
    perfError(`admin.load.${label}`, error);
    throw error;
  }
}
