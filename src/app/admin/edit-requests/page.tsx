import { redirect } from "next/navigation";
import { isAdminUser, requireAuth } from "@/lib/admin-auth";
import { canApproveInvoiceCancel } from "@/lib/invoice-cancel-approve";
import {
  listOrderEditRequestsAction,
  type OrderEditRequestRow,
} from "@/app/admin/order-edit-requests/actions";
import {
  listInvoiceCancelRequestsAction,
  type InvoiceCancelRequestRow,
} from "@/app/admin/invoice-cancel-requests/actions";
import { UnifiedEditRequestsClient } from "@/components/admin/UnifiedEditRequestsClient";

export default async function EditRequestsPage() {
  const me = await requireAuth();
  const isAdmin = isAdminUser(me);
  const canInvoiceCancel = canApproveInvoiceCancel(me);

  if (!isAdmin && !canInvoiceCancel) redirect("/admin");

  let orderEditRows: OrderEditRequestRow[] = [];
  let invoiceCancelRows: InvoiceCancelRequestRow[] = [];

  if (isAdmin) {
    orderEditRows = await listOrderEditRequestsAction();
  }
  if (canInvoiceCancel) {
    invoiceCancelRows = await listInvoiceCancelRequestsAction();
  }

  return (
    <UnifiedEditRequestsClient
      orderEditRows={orderEditRows}
      invoiceCancelRows={invoiceCancelRows}
    />
  );
}
