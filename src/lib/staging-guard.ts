/**
 * בודק שסביבת Staging אינה Production ואינה מערבבת פרויקטים.
 * הודעות השגיאה כוללות מזהה פרויקט בלבד, לא סיסמה ולא מפתח.
 */

export const PRODUCTION_SUPABASE_PROJECT_REFS = ["qileqmeisvibtkvpigct"] as const;

export type EnvMap = Record<string, string | undefined>;

export type ConnectionIdentity = {
  projectRef: string | null;
  host: string | null;
  port: string | null;
};

export type StagingCheck = {
  ok: boolean;
  projectRef: string | null;
  errors: string[];
  warnings: string[];
};

const CONNECTION_KEYS = ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"] as const;
const KEY_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const;

export function identityFromValue(value: string | undefined): ConnectionIdentity {
  const empty = { projectRef: null, host: null, port: null };
  if (!value?.trim()) return empty;
  try {
    const url = new URL(value.trim().replace(/^postgres(ql)?:\/\//i, "https://"));
    const user = decodeURIComponent(url.username || "");
    const userRef = user.match(/postgres\.([a-z0-9]+)/i)?.[1] ?? null;
    const hostRef = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? null;
    return {
      projectRef: (userRef ?? hostRef)?.toLowerCase() ?? null,
      host: url.hostname,
      port: url.port || null,
    };
  } catch {
    return empty;
  }
}

export function projectRefFromJwt(token: string | undefined): string | null {
  if (!token?.trim()) return null;
  const payload = token.trim().split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { ref?: unknown };
    return typeof json.ref === "string" && json.ref.trim() ? json.ref.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

function pushRef(refs: Map<string, string>, label: string, ref: string | null): void {
  if (ref) refs.set(label, ref);
}

export function checkStagingEnv(env: EnvMap): StagingCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const refs = new Map<string, string>();

  if ((env.WEGO_ENV ?? "").trim().toLowerCase() !== "staging") {
    errors.push("WEGO_ENV must be staging");
  }
  if ((env.WEGO_BLOCK_EXTERNAL_SIDE_EFFECTS ?? "").trim() !== "1") {
    errors.push("WEGO_BLOCK_EXTERNAL_SIDE_EFFECTS must be 1");
  }
  for (const name of ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL", "SESSION_SECRET", "NEXTAUTH_SECRET"] as const) {
    if (!env[name]?.trim()) errors.push(`${name} is missing`);
  }
  for (const name of ["SESSION_SECRET", "NEXTAUTH_SECRET"] as const) {
    const value = env[name]?.trim() ?? "";
    if (value && value.length < 16) errors.push(`${name} must be at least 16 characters`);
  }

  for (const name of CONNECTION_KEYS) {
    const identity = identityFromValue(env[name]);
    pushRef(refs, name, identity.projectRef);
    if (env[name]?.trim() && !identity.projectRef) {
      errors.push(`${name} does not identify a Supabase project`);
    }
  }
  for (const name of KEY_KEYS) {
    const ref = projectRefFromJwt(env[name]);
    if (env[name]?.trim() && !ref) {
      warnings.push(`${name} is set but its project ref cannot be read`);
    }
    pushRef(refs, name, ref);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    warnings.push("SUPABASE_SERVICE_ROLE_KEY is missing; archive bytes stay inline");
  }

  const distinct = new Set(refs.values());
  if (distinct.size > 1) {
    errors.push(`Supabase project refs do not match: ${[...refs.entries()].map(([name, ref]) => `${name}=${ref}`).join(", ")}`);
  }
  const projectRef = distinct.size === 1 ? [...distinct][0] ?? null : null;
  if (projectRef && PRODUCTION_SUPABASE_PROJECT_REFS.includes(projectRef as (typeof PRODUCTION_SUPABASE_PROJECT_REFS)[number])) {
    errors.push(`Refusing data-changing operation: Supabase project ${projectRef} is production`);
  }

  return { ok: errors.length === 0 && Boolean(projectRef), projectRef, errors, warnings };
}

export function assertStagingEnv(env: EnvMap): { projectRef: string } {
  const check = checkStagingEnv(env);
  if (!check.ok || !check.projectRef) {
    throw new Error(check.errors.join("; ") || "staging environment was rejected");
  }
  return { projectRef: check.projectRef };
}

export function assertNotProductionDataTarget(env: EnvMap): void {
  const refs = new Set<string>();
  for (const name of CONNECTION_KEYS) {
    const ref = identityFromValue(env[name]).projectRef;
    if (ref) refs.add(ref);
  }
  for (const name of KEY_KEYS) {
    const ref = projectRefFromJwt(env[name]);
    if (ref) refs.add(ref);
  }
  for (const ref of refs) {
    if (PRODUCTION_SUPABASE_PROJECT_REFS.includes(ref as (typeof PRODUCTION_SUPABASE_PROJECT_REFS)[number])) {
      throw new Error(`Refusing data-changing operation: Supabase project ${ref} is production`);
    }
  }
}
