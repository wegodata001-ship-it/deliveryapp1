/**
 * Barrel לשימוש server-only — אל תייבא מקומפוננטות client (value imports).
 * ל-client: `@/lib/order-status-shared`
 */
export type {
  OrderStatusCatalogData,
  OrderStatusSelectOption,
  OrderStatusSourceRow,
  OrderStatusTag,
} from "@/lib/order-status-shared";
export {
  STATUS_COLOR_PRESETS,
  buildEditSelectOptions,
  buildStatusSelectOptions,
  displayStatusCode,
  labelFromMap,
} from "@/lib/order-status-shared";
export {
  countOrdersWithStatus,
  createOrderStatusTag,
  deleteOrderStatusTag,
  ensureOrderStatusSourceTable,
  ensureOrderStatusSourceTableSchema,
  getOrderStatusLabelMap,
  isKnownOrderStatusId,
  isValidOrderStatusId,
  listOrderStatusSourceRows,
  reorderOrderStatusTags,
  resolveOrderStatusFromDisplayText,
  updateOrderStatusTag,
} from "@/lib/order-status-registry-data";
export {
  ORDER_STATUS_CACHE_TAGS,
  fetchOrderStatusCatalogData,
  getOrderStatusUsageMap,
  getOrderStatusUsageMapForManager,
  invalidateOrderStatusDataCaches,
  listOrderStatusTags,
  listOrderStatusTagsForManager,
} from "@/lib/order-status-registry-cache";
