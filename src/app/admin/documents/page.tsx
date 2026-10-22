import { Suspense } from "react";
import { isAdminUser, userHasAnyPermission } from "@/lib/admin-auth";
import { requireRoutePermission } from "@/lib/route-access";
import { DocumentsArchiveClient } from "@/components/admin/DocumentsArchiveClient";

export const dynamic = "force-dynamic";

export default async function DocumentsArchivePage() {
  const me = await requireRoutePermission(["documents.view"]);
  const admin = isAdminUser(me);
  const canDelete = admin || userHasAnyPermission(me, ["documents.delete"]);
  const canDownload = admin || userHasAnyPermission(me, ["documents.download", "documents.view"]);
  const canUpload = admin || userHasAnyPermission(me, ["documents.upload"]);
  return (
    <Suspense fallback={<p className="adm-win-meta">טוען ארכיון מסמכים…</p>}>
      <DocumentsArchiveClient canDelete={canDelete} canDownload={canDownload} canUpload={canUpload} />
    </Suspense>
  );
}
