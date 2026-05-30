import type { Metadata } from "next";
import "./admin-login.css";

export const metadata: Metadata = {
  title: "כניסה למערכת",
  robots: "noindex, nofollow",
};

/** Layout מינימלי — ללא admin layout / Prisma / dashboard */
export default function AdminLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
