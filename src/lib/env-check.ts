const globalEnvWarnings = globalThis as typeof globalThis & { __wegoEnvWarned?: boolean };

export type CriticalEnvName = "DATABASE_URL" | "SESSION_SECRET" | "NEXTAUTH_SECRET";

export function getMissingCriticalEnv(): CriticalEnvName[] {
  const required: CriticalEnvName[] = ["DATABASE_URL", "SESSION_SECRET", "NEXTAUTH_SECRET"];
  return required.filter((name) => !process.env[name]?.trim());
}

export function warnIfMissingCriticalEnv(): void {
  const missing = getMissingCriticalEnv();
  if (missing.length === 0) return;
  if (globalEnvWarnings.__wegoEnvWarned) return;
  globalEnvWarnings.__wegoEnvWarned = true;
  console.error("[env] Missing critical env vars:", missing.join(", "));
}
