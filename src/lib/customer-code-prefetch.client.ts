import { suggestNextCustomerCodeAction } from "@/app/admin/customers/ledger-actions";

let cachedCode: string | null = null;
let prefetchPromise: Promise<string | null> | null = null;

/** טעינה מראש — קורא מקליטת הזמנה / לפני «לקוח חדש» */
export function prefetchNextCustomerCode(): void {
  if (cachedCode || prefetchPromise) return;
  prefetchPromise = suggestNextCustomerCodeAction()
    .then((res) => {
      if (res.ok) cachedCode = res.code;
      return cachedCode;
    })
    .catch(() => null)
    .finally(() => {
      prefetchPromise = null;
    });
}

export async function consumePrefetchedCustomerCode(): Promise<string | null> {
  if (cachedCode) {
    const code = cachedCode;
    cachedCode = null;
    return code;
  }
  if (prefetchPromise) {
    return prefetchPromise;
  }
  const res = await suggestNextCustomerCodeAction();
  return res.ok ? res.code : null;
}

export function resetCustomerCodePrefetch(): void {
  cachedCode = null;
  prefetchPromise = null;
}
