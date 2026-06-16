import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/admin-auth";
import { canApproveInvoiceCancel } from "@/lib/invoice-cancel-approve";
import { listInvoiceCancelRequestsAction } from "@/app/admin/invoice-cancel-requests/actions";
import { InvoiceCancelRequestsClient } from "@/components/admin/InvoiceCancelRequestsClient";

export default async function InvoiceCancelRequestsPage() {
  const me = await requireAuth();
  if (!canApproveInvoiceCancel(me)) redirect("/admin");

  const rows = await listInvoiceCancelRequestsAction();

  return <InvoiceCancelRequestsClient initialRows={rows} />;
}
