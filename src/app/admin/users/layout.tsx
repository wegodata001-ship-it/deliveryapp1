import Link from "next/link";
import { canManageEmployees, requireAuth } from "@/lib/admin-auth";

export default async function AdminUsersLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  if (!canManageEmployees(user)) {
    return (
      <div className="adm-placeholder" style={{ textAlign: "center" }}>
        <h2 style={{ margin: "0 0 0.75rem", color: "var(--adm-text)" }}>אין הרשאה</h2>
        <p style={{ margin: 0, color: "var(--adm-muted)", lineHeight: 1.6 }}>
          נדרשת הרשאת &quot;ניהול משתמשים&quot; או תפקיד מנהל מערכת לצפייה ברשימת העובדים.
        </p>
        <Link href="/admin" className="adm-btn adm-btn--primary" style={{ marginTop: "1.25rem", display: "inline-flex" }}>
          חזרה למסך הבית
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
