import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { revalidateAllKpiCaches } from "@/lib/kpi-cache-revalidate";

/** לא חוסם תשובת שמירת תשלום — רץ אחרי שליחת התגובה ללקוח */
export function scheduleRevalidateAfterPaymentSave(): void {
  const run = () => {
    revalidateAllKpiCaches();
    revalidatePath("/admin/orders");
    revalidatePath("/admin/balances");
    revalidatePath("/admin/source-tables/payments");
  };
  try {
    after(run);
  } catch {
    run();
  }
}
