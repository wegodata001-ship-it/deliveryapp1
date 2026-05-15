import { requireRoutePermission } from "@/lib/route-access";
import { isAdminUser, requireAuth } from "@/lib/admin-auth";
import { ensureDefaultFinancialSettings, getCurrentFinancialSettings, serializeFinancialSettings } from "@/lib/financial-settings";
import { PaymentsUpdatedClient } from "@/app/admin/payments-updated/PaymentsUpdatedClient";

export default async function PaymentsUpdatedPage() {
  await requireRoutePermission(["receive_payments"]);
  const me = await requireAuth();
  await ensureDefaultFinancialSettings();
  const finRow = await getCurrentFinancialSettings();
  const financial = serializeFinancialSettings(finRow);
  return <PaymentsUpdatedClient financial={financial} viewerIsAdmin={isAdminUser(me)} />;
}

