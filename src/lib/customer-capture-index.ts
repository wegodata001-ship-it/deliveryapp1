import type { CustomerSearchRow } from "@/app/admin/capture/actions";
import { CUSTOMER_SEARCH_UUID_RE } from "@/lib/customer-search-shared";

export type CustomerCaptureSearchField = "code" | "nameAr" | "nameEn";

let indexRows: CustomerSearchRow[] | null = null;
let indexPromise: Promise<CustomerSearchRow[]> | null = null;

export function invalidateCustomerCaptureIndex(): void {
  indexRows = null;
  indexPromise = null;
}

/** טעינה מראש בפתיחת קליטת הזמנה — חיפוש ראשון מיידי מהזיכרון */
export function preloadCustomerCaptureIndex(): Promise<CustomerSearchRow[]> {
  if (indexRows) return Promise.resolve(indexRows);
  if (indexPromise) return indexPromise;

  indexPromise = fetch("/api/customers/capture-index", { credentials: "include" })
    .then(async (res) => {
      if (!res.ok) throw new Error("capture-index");
      const data = (await res.json()) as CustomerSearchRow[];
      indexRows = Array.isArray(data) ? data : [];
      return indexRows;
    })
    .catch(() => {
      indexRows = [];
      return indexRows;
    })
    .finally(() => {
      indexPromise = null;
    });

  return indexPromise;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function rowMatchesField(row: CustomerSearchRow, q: string, field: CustomerCaptureSearchField): boolean {
  const n = norm(q);
  if (!n) return false;
  if (field === "code") {
    const code = (row.code ?? "").trim().toLowerCase();
    const old = (row.oldCustomerCode ?? "").trim().toLowerCase();
    if (code === n || old === n) return true;
    if (/^\d+$/.test(n)) return false;
    return code.includes(n) || old.includes(n);
  }
  if (field === "nameAr") {
    return (row.nameAr ?? "").toLowerCase().includes(n) || row.label.toLowerCase().includes(n);
  }
  return (
    (row.nameEn ?? "").toLowerCase().includes(n) ||
    (row.nameHe ?? "").toLowerCase().includes(n) ||
    row.label.toLowerCase().includes(n)
  );
}

export function findCustomerCaptureIndexExact(q: string): CustomerSearchRow | null {
  const list = indexRows;
  if (!list?.length) return null;
  const trimmed = q.trim();
  if (!trimmed) return null;

  if (CUSTOMER_SEARCH_UUID_RE.test(trimmed)) {
    return list.find((r) => r.id === trimmed) ?? null;
  }

  const lower = trimmed.toLowerCase();
  return (
    list.find((r) => (r.code ?? "").trim().toLowerCase() === lower) ??
    list.find((r) => (r.oldCustomerCode ?? "").trim().toLowerCase() === lower) ??
    null
  );
}

export function searchCustomerCaptureIndexLocal(
  q: string,
  field: CustomerCaptureSearchField,
  limit = 20,
): CustomerSearchRow[] {
  const list = indexRows;
  if (!list?.length) return [];
  const trimmed = q.trim();
  if (!trimmed) return [];

  if (field === "code" && (/^\d+$/.test(trimmed) || CUSTOMER_SEARCH_UUID_RE.test(trimmed))) {
    const exact = findCustomerCaptureIndexExact(trimmed);
    return exact ? [exact] : [];
  }

  const out: CustomerSearchRow[] = [];
  for (const row of list) {
    if (rowMatchesField(row, trimmed, field)) {
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function isCustomerCaptureIndexReady(): boolean {
  return indexRows != null && indexRows.length > 0;
}
