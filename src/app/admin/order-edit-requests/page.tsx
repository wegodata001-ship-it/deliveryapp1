import { redirect } from "next/navigation";
import { isAdminUser, requireAuth } from "@/lib/admin-auth";
import { listOrderEditRequestsAction } from "@/app/admin/order-edit-requests/actions";
import { OrderEditRequestsClient } from "@/components/admin/OrderEditRequestsClient";

export default async function OrderEditRequestsPage() {
  const me = await requireAuth();
  if (!isAdminUser(me)) redirect("/admin");

  const rows = await listOrderEditRequestsAction();

  return <OrderEditRequestsClient initialRows={rows} />;
}
