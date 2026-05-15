import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { managedPermissionIdMap } from "@/lib/permissions";
import { EditUserForm, type EditUserSafe } from "@/components/admin/EditUserForm";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      username: true,
      role: true,
      isActive: true,
      permissions: { select: { permissionId: true } },
    },
  });

  if (!user) notFound();

  const permissionByKey = await managedPermissionIdMap(prisma);

  const safe: EditUserSafe = {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    permissionIds: user.permissions.map((p) => p.permissionId),
  };

  return (
    <>
      <p style={{ color: "var(--adm-muted)", marginTop: 0, marginBottom: "1.25rem", maxWidth: "560px", lineHeight: 1.6 }}>
        עדכון פרטי משתמש והרשאות. השארת שדה הסיסמה ריקה משמרת את הסיסמה הקיימת.
      </p>
      <EditUserForm user={safe} permissionByKey={permissionByKey} />
    </>
  );
}
