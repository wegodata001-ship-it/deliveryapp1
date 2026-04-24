import { redirect } from "next/navigation";
import type { AppUser } from "@/lib/admin-auth";
import { requireAuth, userHasAnyPermission } from "@/lib/admin-auth";

export async function requireRoutePermission(keys: string[]): Promise<AppUser> {
  const user = await requireAuth();
  if (!userHasAnyPermission(user, keys)) redirect("/admin");
  return user;
}
