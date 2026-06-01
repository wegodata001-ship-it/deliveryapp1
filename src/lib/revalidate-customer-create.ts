import { after } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { capturePerfLog } from "@/lib/capture-perf";
import { customerCardSnapshotTag } from "@/lib/customer-card-snapshot-cache";
import { CUSTOMERS_SOURCE_KPIS_TAG } from "@/lib/customers-source-table";

/** Tag for future cached customer-ledger list; invalidated on every create/update. */
export const CUSTOMER_LEDGER_LIST_TAG = "customer-ledger-list";

/** Server-side cache bust after customer create or profile update. */
export function revalidateAfterCustomerCreate(customerId: string): void {
  revalidatePath("/admin/customer-card");
  revalidatePath("/admin/balances");
  revalidatePath("/admin/source-tables/customers");
  revalidatePath("/admin/source-tables");
  revalidateTag(CUSTOMER_LEDGER_LIST_TAG);
  revalidateTag(CUSTOMERS_SOURCE_KPIS_TAG);
  const id = customerId.trim();
  if (id) revalidateTag(customerCardSnapshotTag(id));
}

/** לא חוסם תשובת API — רץ אחרי שליחת התגובה (Next `after`) */
export function scheduleRevalidateAfterCustomerCreate(customerId: string): void {
  const id = customerId.trim();
  if (!id) return;

  const run = () => {
    const t0 = Date.now();
    revalidateAfterCustomerCreate(id);
    capturePerfLog({
      deferredRevalidateAfterCustomerCreateMs: Date.now() - t0,
      customerId: id,
    });
  };

  try {
    after(run);
  } catch {
    run();
  }
}
