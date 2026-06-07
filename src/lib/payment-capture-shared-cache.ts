import {
  clonePaymentCaptureSnapshot,
  createPaymentCaptureSnapshotCache,
  type PaymentCaptureSnapshot,
  type PaymentCaptureSnapshotCache,
} from "@/lib/payment-capture-snapshot";

/** Lightweight payment entry — enough to render form + customer summary */
export type SharedPaymentEntry = {
  id: string;
  paymentCode: string | null;
  paymentNumber?: number | null;
  paymentDateYmd: string;
  paymentTimeHm: string;
  dollarRate: string | null;
  commissionPercent?: string | null;
  status?: "ACTIVE" | "CANCELLED";
  cancelReason?: string | null;
  customer: {
    id: string;
    displayName: string;
    customerCode: string;
    customerIndex: string;
    nameEn: string;
    nameAr: string;
    phone: string;
  };
  lines: Array<Record<string, unknown> & { id: string }>;
};

function cloneSharedPaymentEntry(e: SharedPaymentEntry): SharedPaymentEntry {
  return {
    ...e,
    customer: { ...e.customer },
    lines: e.lines.map((l) => {
      const checks = l.checks;
      return {
        ...l,
        checks: Array.isArray(checks) ? checks.map((c) => ({ ...(c as Record<string, unknown>) })) : checks,
      };
    }),
  };
}

type SharedCacheGlobal = {
  snapshotCache: PaymentCaptureSnapshotCache;
  entryById: Map<string, SharedPaymentEntry>;
  entryByCode: Map<string, SharedPaymentEntry>;
  entryInflight: Map<string, Promise<SharedPaymentEntry | null>>;
};

const GLOBAL_KEY = "__wegoPaymentCaptureSharedCache__";

function getGlobal(): SharedCacheGlobal {
  const g = globalThis as typeof globalThis & { [GLOBAL_KEY]?: SharedCacheGlobal };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      snapshotCache: createPaymentCaptureSnapshotCache(),
      entryById: new Map(),
      entryByCode: new Map(),
      entryInflight: new Map(),
    };
  }
  return g[GLOBAL_KEY];
}

export function getSharedPaymentSnapshotCache(): PaymentCaptureSnapshotCache {
  return getGlobal().snapshotCache;
}

export function cacheSharedPaymentEntry(entry: SharedPaymentEntry): void {
  const snap = cloneSharedPaymentEntry(entry);
  const id = snap.id?.trim();
  const code = snap.paymentCode?.trim().toUpperCase();
  const { entryById, entryByCode } = getGlobal();
  if (id) entryById.set(id, snap);
  if (code) entryByCode.set(code, snap);
}

export function getSharedPaymentEntry(paymentIdOrCode: string): SharedPaymentEntry | undefined {
  const key = paymentIdOrCode.trim();
  const codeKey = key.toUpperCase();
  const { entryById, entryByCode } = getGlobal();
  const hit = entryById.get(key) ?? entryByCode.get(codeKey);
  return hit ? cloneSharedPaymentEntry(hit) : undefined;
}

export function cacheSharedPaymentSnapshot(snapshot: PaymentCaptureSnapshot): void {
  getGlobal().snapshotCache.set(clonePaymentCaptureSnapshot(snapshot));
}

export function getSharedPaymentSnapshot(
  paymentId: string,
  paymentCode?: string | null,
): PaymentCaptureSnapshot | undefined {
  const id = paymentId.trim();
  const code = paymentCode?.trim().toUpperCase() || null;
  const cache = getGlobal().snapshotCache;
  return cache.get(id) ?? (code ? cache.getByCode(code) : undefined);
}

/** Prefetch payment entry (e.g. hover on source table row) — no orders load */
export function prefetchSharedPaymentEntry(paymentId: string): void {
  const id = paymentId.trim();
  if (!id || getSharedPaymentEntry(id)) return;

  const { entryInflight } = getGlobal();
  if (entryInflight.has(id)) return;

  const p = fetch(`/api/payments/entry?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
    credentials: "include",
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const entry = (await res.json()) as SharedPaymentEntry;
      cacheSharedPaymentEntry(entry);
      return entry;
    })
    .catch(() => null)
    .finally(() => {
      entryInflight.delete(id);
    });

  entryInflight.set(id, p);
}
