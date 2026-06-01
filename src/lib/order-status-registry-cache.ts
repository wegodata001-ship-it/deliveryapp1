import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import {
  buildStatusSelectOptions,
  type OrderStatusCatalogData,
  type OrderStatusTag,
} from "@/lib/order-status-shared";
import {
  loadOrderStatusUsageMapUncached,
  readOrderStatusTagsFromDb,
} from "@/lib/order-status-registry-data";

export const ORDER_STATUS_CACHE_TAGS = {
  tags: "order-status-tags",
  tagsAll: "order-status-tags-all",
  usage: "order-status-usage-map",
  catalog: "wego-order-status-catalog",
} as const;

const getCachedOrderStatusTagsActive = unstable_cache(
  () => readOrderStatusTagsFromDb(false),
  ["order-status-tags-active-v2"],
  { revalidate: 300, tags: [ORDER_STATUS_CACHE_TAGS.tags] },
);

const getCachedOrderStatusTagsAll = unstable_cache(
  () => readOrderStatusTagsFromDb(true),
  ["order-status-tags-all-v2"],
  { revalidate: 300, tags: [ORDER_STATUS_CACHE_TAGS.tagsAll] },
);

const getCachedOrderStatusUsageMap = unstable_cache(
  () => loadOrderStatusUsageMapUncached(),
  ["order-status-usage-map-v2"],
  { revalidate: 300, tags: [ORDER_STATUS_CACHE_TAGS.usage] },
);

const fetchOrderStatusCatalogDataCached = unstable_cache(
  async (): Promise<OrderStatusCatalogData> => {
    const statuses = await readOrderStatusTagsFromDb(false);
    const labelById = Object.fromEntries(statuses.map((r) => [r.id, r.nameHe]));
    return {
      statuses,
      labelById,
      options: buildStatusSelectOptions(statuses),
    };
  },
  ["wego-order-status-catalog-v2"],
  { revalidate: 300, tags: [ORDER_STATUS_CACHE_TAGS.catalog] },
);

export function invalidateOrderStatusDataCaches(): void {
  revalidateTag(ORDER_STATUS_CACHE_TAGS.tags);
  revalidateTag(ORDER_STATUS_CACHE_TAGS.tagsAll);
  revalidateTag(ORDER_STATUS_CACHE_TAGS.usage);
  revalidateTag(ORDER_STATUS_CACHE_TAGS.catalog);
}

export async function listOrderStatusTags(includeInactive = false): Promise<OrderStatusTag[]> {
  return includeInactive ? getCachedOrderStatusTagsAll() : getCachedOrderStatusTagsActive();
}

export async function listOrderStatusTagsForManager(): Promise<OrderStatusTag[]> {
  return getCachedOrderStatusTagsAll();
}

export async function getOrderStatusUsageMap(): Promise<Record<string, number>> {
  return getCachedOrderStatusUsageMap();
}

export async function getOrderStatusUsageMapForManager(): Promise<Record<string, number>> {
  return getCachedOrderStatusUsageMap();
}

export async function fetchOrderStatusCatalogData(): Promise<OrderStatusCatalogData> {
  return fetchOrderStatusCatalogDataCached();
}
