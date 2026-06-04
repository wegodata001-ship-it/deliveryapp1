import { redirect } from "next/navigation";
import { requireRoutePermission } from "@/lib/route-access";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** תאימות לקישורים ישנים — מעבר ל-Workspace במסך אחד */
export default async function CustomerProfileRedirectPage({ params }: Props) {
  await requireRoutePermission(["view_customers", "view_customer_card", "view_reports"]);
  const { id } = await params;
  const cid = id.trim();
  if (!cid) redirect("/admin/customers");
  redirect(`/admin/customers?customer=${encodeURIComponent(cid)}`);
}
