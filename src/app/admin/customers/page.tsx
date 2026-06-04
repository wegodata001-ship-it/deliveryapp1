import { Suspense } from "react";
import { CustomerWorkspaceClient } from "@/app/admin/customers/CustomerWorkspaceClient";
import { requireRoutePermission } from "@/lib/route-access";

export const dynamic = "force-dynamic";

export default async function CustomersModulePage() {
  await requireRoutePermission(["view_customers", "view_customer_card", "view_reports"]);
  return (
    <div className="adm-page adm-page--workspace adm-cust-module-page adm-cust-module-page--premium">
      <Suspense fallback={<p className="adm-win-meta">טוען מרכז לקוחות…</p>}>
        <CustomerWorkspaceClient />
      </Suspense>
    </div>
  );
}
