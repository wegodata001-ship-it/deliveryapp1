import "server-only";

/**
 * שכבת אחסון Supabase Storage דרך REST (ללא תלות חיצונית).
 * משתמשת ב-SERVICE_ROLE_KEY בצד שרת בלבד. הדלי הוא פרטי — גישה דרך Signed URLs.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function documentsBucket(): string {
  return process.env.SUPABASE_DOCUMENTS_BUCKET || "doc-atlas";
}

export function storageConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY };
}

function encodePath(p: string): string {
  return p
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export async function uploadObject(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  if (!storageConfigured()) throw new Error("אחסון מסמכים אינו מוגדר (Supabase)");
  const url = `${SUPABASE_URL}/storage/v1/object/${documentsBucket()}/${encodePath(path)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    },
    body: bytes as unknown as BodyInit,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`העלאת קובץ נכשלה (${res.status}) ${detail}`);
  }
}

export async function createSignedUrl(path: string, expiresInSeconds: number): Promise<string> {
  if (!storageConfigured()) throw new Error("אחסון מסמכים אינו מוגדר (Supabase)");
  const url = `${SUPABASE_URL}/storage/v1/object/sign/${documentsBucket()}/${encodePath(path)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`יצירת קישור חתום נכשלה (${res.status}) ${detail}`);
  }
  const json = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const rel = json.signedURL ?? json.signedUrl ?? "";
  if (!rel) throw new Error("לא התקבל קישור חתום");
  return `${SUPABASE_URL}/storage/v1${rel.startsWith("/") ? rel : `/${rel}`}`;
}

export async function removeObject(path: string): Promise<void> {
  if (!storageConfigured()) return;
  const url = `${SUPABASE_URL}/storage/v1/object/${documentsBucket()}/${encodePath(path)}`;
  const res = await fetch(url, { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    throw new Error(`מחיקת קובץ נכשלה (${res.status}) ${detail}`);
  }
}

export function signedUrlExpirationSeconds(): number {
  const n = Number(process.env.SIGNED_URL_EXPIRATION ?? "3600");
  return Number.isFinite(n) && n > 0 ? n : 3600;
}

export function allowedExtensionsFromEnv(): string[] {
  const raw = (process.env.ALLOWED_UPLOADS ?? "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

export function maxUploadMbFromEnv(): number {
  const n = Number(process.env.MAX_UPLOAD_MB ?? "20");
  return Number.isFinite(n) && n > 0 ? n : 20;
}
