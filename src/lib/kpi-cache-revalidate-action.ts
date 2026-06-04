"use server";

import { revalidateAllKpiCaches } from "@/lib/kpi-cache-revalidate";

/** נקרא מ-GlobalFilterBar (client) בעת החלפת מדינה */
export async function revalidateAllKpiCachesAction(): Promise<void> {
  revalidateAllKpiCaches();
}
