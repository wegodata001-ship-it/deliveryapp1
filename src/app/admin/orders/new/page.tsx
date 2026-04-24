import { redirect } from "next/navigation";
import { requireRoutePermission } from "@/lib/route-access";

export default async function OrderIntakeRedirectPage() {
  await requireRoutePermission(["create_orders"]);
  redirect("/admin/orders?orderWork=new");
}
