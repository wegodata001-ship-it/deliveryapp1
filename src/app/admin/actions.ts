"use server";

import { redirect } from "next/navigation";
import { recordActivityAudit } from "@/lib/activity-audit";
import { clearAdminSession, getSessionPayload } from "@/lib/admin-auth";

export async function logoutAction(): Promise<void> {
  const payload = await getSessionPayload();
  const userId = payload?.sub;
  await clearAdminSession();
  if (userId) {
    recordActivityAudit({
      userId,
      actionType: "USER_LOGOUT",
      entityType: "User",
      entityId: userId,
    });
  }
  redirect("/admin-login");
}
