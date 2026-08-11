/**
 * Supabase pooler (PgBouncer) — פרמטרים מומלצים ל-Prisma.
 * מונע "connection forcibly closed" (Windows 10054 / ECONNRESET) כשה-pooler סוגר חיבורים idle.
 */

const DEFAULT_CONNECT_TIMEOUT = "15";
const DEFAULT_POOL_TIMEOUT = "15";

function defaultConnectionLimit(): string {
  if (process.env.PRISMA_CONNECTION_LIMIT?.trim()) {
    return process.env.PRISMA_CONNECTION_LIMIT.trim();
  }
  return process.env.NODE_ENV === "production" ? "5" : "3";
}

/** מוסיף פרמטרי pool חסרים ל-DATABASE_URL (לא דורס ערכים קיימים). */
export function normalizeDatabaseUrlForPrisma(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return raw;

  const trimmed = raw.trim();
  const params = new URLSearchParams(trimmed.includes("?") ? trimmed.split("?")[1] : "");

  if (!params.has("pgbouncer")) params.set("pgbouncer", "true");
  if (!params.has("connect_timeout")) params.set("connect_timeout", DEFAULT_CONNECT_TIMEOUT);
  if (!params.has("pool_timeout")) params.set("pool_timeout", DEFAULT_POOL_TIMEOUT);
  if (!params.has("connection_limit")) params.set("connection_limit", defaultConnectionLimit());

  const base = trimmed.includes("?") ? trimmed.split("?")[0]! : trimmed;
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** מעדכן process.env.DATABASE_URL לפני יצירת PrismaClient */
export function applyPrismaDatabaseUrlDefaults(): void {
  const normalized = normalizeDatabaseUrlForPrisma(process.env.DATABASE_URL);
  if (normalized && normalized !== process.env.DATABASE_URL) {
    process.env.DATABASE_URL = normalized;
  }
}

const CONNECTION_ERROR_CODES = new Set(["P1001", "P1008", "P1017", "P2024"]);

export function isPrismaConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  if (e.code && CONNECTION_ERROR_CODES.has(e.code)) return true;
  const msg = String(e.message ?? error).toLowerCase();
  return (
    msg.includes("connectionreset") ||
    msg.includes("forcibly closed") ||
    msg.includes("connection terminated") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("can't reach database") ||
    msg.includes("server has closed the connection")
  );
}
