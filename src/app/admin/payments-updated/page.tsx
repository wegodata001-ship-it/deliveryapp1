import { requireRoutePermission } from "@/lib/route-access";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings, serializeFinancialSettings } from "@/lib/financial-settings";
import { PaymentsUpdatedClient } from "@/app/admin/payments-updated/PaymentsUpdatedClient";

export default async function PaymentsUpdatedPage() {
  await requireRoutePermission(["receive_payments"]);
  await ensureDefaultFinancialSettings();
  const finRow = await getCurrentFinancialSettings();
  const financial = serializeFinancialSettings(finRow);
  return <PaymentsUpdatedClient financial={financial} />;
}

