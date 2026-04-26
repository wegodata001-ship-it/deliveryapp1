import { redirect } from "next/navigation";
import { requireRoutePermission } from "@/lib/route-access";

export default async function PaymentIntakeRedirectPage() {
  await requireRoutePermission(["receive_payments"]);
  redirect("/admin");
}
