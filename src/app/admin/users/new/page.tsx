import { prisma } from "@/lib/prisma";
import { uniqueManagedKeys } from "@/lib/employee-permission-groups";
import { CreateUserForm } from "@/components/admin/CreateUserForm";

export default async function NewUserPage() {
  const keys = uniqueManagedKeys();
  const rows = await prisma.permission.findMany({
    where: { key: { in: [...keys] }, isActive: true },
    select: { id: true, key: true },
  });
  const permissionByKey = Object.fromEntries(rows.map((r) => [r.key, r.id]));

  return (
    <>
      <p style={{ color: "var(--adm-muted)", marginTop: 0, marginBottom: "1.25rem", maxWidth: "560px", lineHeight: 1.6 }}>
        יצירת משתמש חדש. התחברות מתבצעת בשם משתמש וסיסמה. הרשאות נבחרות כאן בלבד — אין מסך נפרד לניהול הרשאות.
      </p>
      <CreateUserForm permissionByKey={permissionByKey} />
    </>
  );
}
