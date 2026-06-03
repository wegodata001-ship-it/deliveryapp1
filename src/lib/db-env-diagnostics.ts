/**
 * אבחון חיבור DB — לוג חד-פעמי לכל process + לפי route.
 * לא מדפיס סיסמאות מלאות.
 */

const loggedRoutes = new Set<string>();
let loggedGlobal = false;

export type DbEnvSnapshot = {
  nodeEnv: string;
  databaseUrlMasked: string | null;
  directUrlMasked: string | null;
  shadowDatabaseUrlMasked: string | null;
  databaseUrlOldMasked: string | null;
  supabaseUrlMasked: string | null;
  prismaInstanceId: string;
  hostFingerprint: string | null;
  warnings: string[];
};

function maskConnectionUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.replace(/^postgres(ql)?:\/\//, "https://"));
    const user = u.username ? `${u.username.slice(0, 2)}***` : "";
    const host = u.hostname || "?";
    const port = u.port ? `:${u.port}` : "";
    const db = u.pathname?.replace(/^\//, "") || "postgres";
    const params = u.search ? u.search.slice(0, 40) + (u.search.length > 40 ? "…" : "") : "";
    return `postgresql://${user}@${host}${port}/${db}${params}`;
  } catch {
    const s = raw.trim();
    return s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-6)}` : "***";
  }
}

function hostFingerprint(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.replace(/^postgres(ql)?:\/\//, "https://"));
    return `${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return null;
  }
}

function detectProjectHint(env: NodeJS.ProcessEnv): string[] {
  const warnings: string[] = [];
  const urls = [
    env.DATABASE_URL,
    env.DIRECT_URL,
    env.SHADOW_DATABASE_URL,
    env.DATABASE_URL_OLD,
    env.SUPABASE_URL,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (urls.includes("sweet")) warnings.push('מזוהה מחרוזת "sweet" ב-URL — ודא שאין מיזוג פרויקטים');
  if (urls.includes("deliveryapp") || urls.includes("delivery"))
    warnings.push('מזוהה מחרוזת "delivery" ב-URL — ודא שאין מיזוג פרויקטים');

  const dbHost = hostFingerprint(env.DATABASE_URL);
  const directHost = hostFingerprint(env.DIRECT_URL);
  if (dbHost && directHost && dbHost !== directHost) {
    warnings.push(`DATABASE_URL host (${dbHost}) ≠ DIRECT_URL host (${directHost}) — צפוי לאותו Supabase, פורטים שונים`);
  }

  if (env.DATABASE_URL_OLD?.trim()) {
    warnings.push("DATABASE_URL_OLD מוגדר — עלול לבלבל; ודא שהאפליקציה משתמשת רק ב-DATABASE_URL");
  }

  const dbFp = hostFingerprint(env.DATABASE_URL);
  const oldFp = hostFingerprint(env.DATABASE_URL_OLD);
  if (dbFp && oldFp && dbFp !== oldFp) {
    warnings.push("DATABASE_URL ו-DATABASE_URL_OLD מצביעים על hosts שונים");
  }

  return warnings;
}

export function getDbEnvSnapshot(prismaInstanceId = "singleton"): DbEnvSnapshot {
  const warnings = detectProjectHint(process.env);
  return {
    nodeEnv: process.env.NODE_ENV ?? "undefined",
    databaseUrlMasked: maskConnectionUrl(process.env.DATABASE_URL),
    directUrlMasked: maskConnectionUrl(process.env.DIRECT_URL),
    shadowDatabaseUrlMasked: maskConnectionUrl(process.env.SHADOW_DATABASE_URL),
    databaseUrlOldMasked: maskConnectionUrl(process.env.DATABASE_URL_OLD),
    supabaseUrlMasked: maskConnectionUrl(
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    prismaInstanceId,
    hostFingerprint: hostFingerprint(process.env.DATABASE_URL),
    warnings,
  };
}

/** לוג בתחילת API / server action — פעם אחת לכל route לכל process */
export function logDbEnvDiagnostics(route: string, prismaInstanceId = "singleton"): void {
  const key = route || "unknown";
  if (!loggedGlobal) {
    loggedGlobal = true;
    const snap = getDbEnvSnapshot(prismaInstanceId);
    console.log("[db-env] global (first load)", snap);
  }
  if (loggedRoutes.has(key)) return;
  loggedRoutes.add(key);

  const snap = getDbEnvSnapshot(prismaInstanceId);
  console.log(`[db-env] route=${key}`, {
    NODE_ENV: snap.nodeEnv,
    DATABASE_URL: snap.databaseUrlMasked,
    SUPABASE_URL: snap.supabaseUrlMasked,
    DIRECT_URL: snap.directUrlMasked,
    SHADOW_DATABASE_URL: snap.shadowDatabaseUrlMasked,
    DATABASE_URL_OLD: snap.databaseUrlOldMasked,
    prismaInstanceId: snap.prismaInstanceId,
    hostFingerprint: snap.hostFingerprint,
    warnings: snap.warnings,
  });
}
