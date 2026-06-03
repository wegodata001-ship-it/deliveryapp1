/**
 * Process-level memoization for one-time DDL bootstrap helpers.
 *
 * Many `ensureXxxTable()` helpers in the codebase issue raw
 * `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements
 * on every call. While these are no-ops on a populated database, each one
 * still costs a planner + lock-acquisition round-trip — multiplied across
 * 5-10 helpers per hot path (e.g. order save), it adds hundreds of ms.
 *
 * This wrapper runs each `key`'s function at most once per Node process.
 * After a successful run, subsequent calls become a synchronous in-memory
 * `Set.has` check (sub-microsecond).
 *
 * Uses `globalThis` so Next.js dev HMR does not re-run heavy DDL on every
 * hot reload (module-level Sets would reset).
 *
 * Trade-off: if someone manually drops the table while the Node process is
 * still running, the helper won't re-create it. In practice, schema changes
 * are followed by a deploy / restart, so this is acceptable.
 */

type EnsureOnceGlobal = {
  ensured: Set<string>;
  inFlight: Map<string, Promise<void>>;
};

const GLOBAL_KEY = "__wegoEnsureOnce";

function getEnsureState(): EnsureOnceGlobal {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: EnsureOnceGlobal };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { ensured: new Set(), inFlight: new Map() };
  }
  return g[GLOBAL_KEY];
}

export async function ensureOnce(key: string, fn: () => Promise<void>): Promise<void> {
  const { ensured, inFlight } = getEnsureState();
  if (ensured.has(key)) return;

  const existing = inFlight.get(key);
  if (existing) {
    await existing;
    return;
  }

  const promise = (async () => {
    try {
      await fn();
      ensured.add(key);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  await promise;
}

/** For tests only — reset the cache. */
export function __resetEnsureOnceForTests(): void {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: EnsureOnceGlobal };
  g[GLOBAL_KEY] = { ensured: new Set(), inFlight: new Map() };
}
