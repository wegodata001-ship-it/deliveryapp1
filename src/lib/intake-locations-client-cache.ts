const SESSION_KEY = "wego.intakeLocations.v1";
const TTL_MS = 300_000;

type Row = { id: string; label: string };

let memoryCache: { rows: Row[]; expires: number } | null = null;

function readSessionCache(): Row[] | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows: Row[]; expires: number };
    if (!parsed?.rows?.length || parsed.expires < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed.rows;
  } catch {
    return null;
  }
}

function writeSessionCache(rows: Row[]): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ rows, expires: Date.now() + TTL_MS }),
    );
  } catch {
    /* quota */
  }
}

export function getIntakeLocationsClientCache(): Row[] | null {
  const now = Date.now();
  if (memoryCache && memoryCache.expires > now) return memoryCache.rows;
  const fromSession = readSessionCache();
  if (fromSession) {
    memoryCache = { rows: fromSession, expires: now + TTL_MS };
    return fromSession;
  }
  return null;
}

export function setIntakeLocationsClientCache(rows: Row[]): void {
  const expires = Date.now() + TTL_MS;
  memoryCache = { rows, expires };
  writeSessionCache(rows);
}
