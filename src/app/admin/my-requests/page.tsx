import { redirect } from "next/navigation";
import { isAdminUser, requireAuth, userHasAnyPermission } from "@/lib/admin-auth";
import { listMyOrderEditRequestsAction } from "@/app/admin/order-edit-requests/actions";
import { MyRequestsClient } from "@/components/admin/MyRequestsClient";

export default async function MyRequestsPage() {
  const me = await requireAuth();
  if (isAdminUser(me)) redirect("/admin/edit-requests");
  if (!userHasAnyPermission(me, ["edit_orders"])) redirect("/admin");

  const rows = await listMyOrderEditRequestsAction();

  return <MyRequestsClient initialRows={rows} />;
}
