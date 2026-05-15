import { prisma } from "@/lib/prisma";
import { managedPermissionIdMap } from "@/lib/permissions";
import { CreateUserForm } from "@/components/admin/CreateUserForm";

export default async function NewUserPage() {
  const permissionByKey = await managedPermissionIdMap(prisma);

  return (
    <>
      <p style={{ color: "var(--adm-muted)", marginTop: 0, marginBottom: "1.25rem", maxWidth: "560px", lineHeight: 1.6 }}>
        יצירת משתמש חדש. התחברות מתבצעת בשם משתמש וסיסמה. הרשאות נבחרות כאן בלבד — אין מסך נפרד לניהול הרשאות.
      </p>
      <CreateUserForm permissionByKey={permissionByKey} />
    </>
  );
}
