import { headers } from "next/headers";

/** Set by middleware for lightweight admin routes (e.g. source tables). */
export const ADMIN_ROUTE_MODE_HEADER = "x-wego-admin-mode";

export type AdminRouteMode = "light" | "full";

export function isSourceTablesPath(pathname: string): boolean {
  return pathname === "/admin/source-tables" || pathname.startsWith("/admin/source-tables/");
}

export function isCustomerCardPath(pathname: string): boolean {
  return pathname === "/admin/customer-card" || pathname.startsWith("/admin/customer-card/");
}

export function isLightAdminPath(pathname: string): boolean {
  return isSourceTablesPath(pathname) || isCustomerCardPath(pathname);
}

export function isDashboardPath(pathname: string): boolean {
  return pathname === "/admin" || pathname === "/admin/";
}

export async function getAdminRouteMode(): Promise<AdminRouteMode> {
  const h = await headers();
  return h.get(ADMIN_ROUTE_MODE_HEADER) === "light" ? "light" : "full";
}
