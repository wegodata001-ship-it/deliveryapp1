import { isAdminUser, userHasAnyPermission } from "@/lib/admin-auth";
import { requireRoutePermission } from "@/lib/route-access";
import { DocumentsArchiveClient } from "@/components/admin/DocumentsArchiveClient";

export const dynamic = "force-dynamic";

export default async function DocumentsArchivePage() {
  const me = await requireRoutePermission(["documents.view"]);
  const admin = isAdminUser(me);
  const canDelete = admin || userHasAnyPermission(me, ["documents.delete"]);
  const canDownload = admin || userHasAnyPermission(me, ["documents.download", "documents.view"]);
  return <DocumentsArchiveClient canDelete={canDelete} canDownload={canDownload} />;
}
