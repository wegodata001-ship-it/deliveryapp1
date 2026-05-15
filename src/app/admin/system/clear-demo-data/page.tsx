import { redirect } from "next/navigation";
import { ClearDemoDataClient } from "@/components/admin/ClearDemoDataClient";
import { requireAuth } from "@/lib/admin-auth";
import { canClearDemoData, getClearDemoDataPlan } from "@/lib/clear-demo-data";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export default async function ClearDemoDataPage() {
  const me = await requireAuth();
  if (!canClearDemoData(me)) redirect("/admin");

  const plan = await getClearDemoDataPlan(prisma);
  return <ClearDemoDataClient plan={plan} />;
}
