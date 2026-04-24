import Link from "next/link";
import { Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/admin-auth";
import { toggleUserActiveAction } from "./actions";

function roleLabel(role: string): string {
  if (role === "ADMIN") return "מנהל מערכת";
  if (role === "EMPLOYEE") return "עובד";
  return role;
}

export default async function AdminUsersPage() {
  const current = await requireAuth();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      username: true,
      role: true,
      isActive: true,
      permissions: {
        select: {
          permission: { select: { name: true, key: true } },
        },
      },
    },
  });

  return (
    <>
      <div className="adm-toolbar">
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>רשימת משתמשים</h2>
        <Link href="/admin/users/new" className="adm-btn adm-btn--primary">
          הוספת עובד
        </Link>
      </div>

      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>שם עובד</th>
              <th>שם משתמש</th>
              <th>תפקיד</th>
              <th>הרשאות</th>
              <th>סטטוס</th>
              <th style={{ width: "200px" }}>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const names = u.permissions.map((x) => x.permission.name);
              const permPreview =
                names.length === 0
                  ? "—"
                  : names.length <= 2
                    ? names.join(" · ")
                    : `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
              const isSelf = u.id === current.id;
              return (
                <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.65 }}>
                  <td style={{ fontWeight: 600 }}>{u.fullName}</td>
                  <td>{u.username ?? "—"}</td>
                  <td>
                    <span className="adm-badge adm-badge--role">{roleLabel(u.role)}</span>
                  </td>
                  <td style={{ color: "var(--adm-muted)", fontSize: "0.85rem", maxWidth: "280px" }}>{permPreview}</td>
                  <td>
                    <span className={`adm-badge ${u.isActive ? "adm-badge--ok" : "adm-badge--off"}`}>
                      {u.isActive ? "פעיל" : "לא פעיל"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                      <Link href={`/admin/users/${u.id}/edit`} className="adm-btn adm-btn--ghost adm-btn--sm">
                        <Pencil size={14} aria-hidden />
                        עריכה
                      </Link>
                      <form action={toggleUserActiveAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          type="submit"
                          className={`adm-btn adm-btn--sm ${u.isActive ? "adm-btn--danger" : "adm-btn--ghost"}`}
                          disabled={isSelf}
                          title={isSelf ? "לא ניתן לשנות את החשבון שלך מכאן" : undefined}
                        >
                          {u.isActive ? "שבת" : "הפעל"}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
