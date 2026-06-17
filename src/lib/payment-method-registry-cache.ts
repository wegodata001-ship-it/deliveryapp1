import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import {
  buildPaymentMethodSelectOptions,
  type PaymentMethodCatalogData,
  type PaymentMethodTag,
} from "@/lib/payment-method-shared";
import {
  loadPaymentMethodUsageMapUncached,
  readPaymentMethodTagsFromDb,
} from "@/lib/payment-method-registry-data";

export const PAYMENT_METHOD_CACHE_TAGS = {
  tags: "payment-method-tags",
  tagsAll: "payment-method-tags-all",
  usage: "payment-method-usage-map",
  catalog: "wego-payment-method-catalog",
} as const;

const getCachedPaymentMethodTagsActive = unstable_cache(
  () => readPaymentMethodTagsFromDb(false),
  ["payment-method-tags-active-v1"],
  { revalidate: 300, tags: [PAYMENT_METHOD_CACHE_TAGS.tags] },
);

const getCachedPaymentMethodTagsAll = unstable_cache(
  () => readPaymentMethodTagsFromDb(true),
  ["payment-method-tags-all-v1"],
  { revalidate: 300, tags: [PAYMENT_METHOD_CACHE_TAGS.tagsAll] },
);

const getCachedPaymentMethodUsageMap = unstable_cache(
  () => loadPaymentMethodUsageMapUncached(),
  ["payment-method-usage-map-v1"],
  { revalidate: 300, tags: [PAYMENT_METHOD_CACHE_TAGS.usage] },
);

const fetchPaymentMethodCatalogDataCached = unstable_cache(
  async (): Promise<PaymentMethodCatalogData> => {
    const methods = await readPaymentMethodTagsFromDb(false);
    const labelById = Object.fromEntries(methods.map((r) => [r.id, r.nameHe]));
    return {
      methods,
      labelById,
      options: buildPaymentMethodSelectOptions(methods),
    };
  },
  ["wego-payment-method-catalog-v1"],
  { revalidate: 300, tags: [PAYMENT_METHOD_CACHE_TAGS.catalog] },
);

export function invalidatePaymentMethodDataCaches(): void {
  revalidateTag(PAYMENT_METHOD_CACHE_TAGS.tags);
  revalidateTag(PAYMENT_METHOD_CACHE_TAGS.tagsAll);
  revalidateTag(PAYMENT_METHOD_CACHE_TAGS.usage);
  revalidateTag(PAYMENT_METHOD_CACHE_TAGS.catalog);
}

export async function listPaymentMethodTags(includeInactive = false): Promise<PaymentMethodTag[]> {
  return includeInactive ? getCachedPaymentMethodTagsAll() : getCachedPaymentMethodTagsActive();
}

export async function listPaymentMethodTagsForManager(): Promise<PaymentMethodTag[]> {
  return getCachedPaymentMethodTagsAll();
}

export async function getPaymentMethodUsageMap(): Promise<Record<string, number>> {
  return getCachedPaymentMethodUsageMap();
}

export async function getPaymentMethodUsageMapForManager(): Promise<Record<string, number>> {
  return getCachedPaymentMethodUsageMap();
}

export async function fetchPaymentMethodCatalogData(): Promise<PaymentMethodCatalogData> {
  return fetchPaymentMethodCatalogDataCached();
}
