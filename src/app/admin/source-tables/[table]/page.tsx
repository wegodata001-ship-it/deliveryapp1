import Link from "next/link";
import { notFound } from "next/navigation";
import { listSourceTableDataAction, type SourceTableId } from "@/app/admin/source-tables/actions";
import { SourceTableProClient } from "@/components/admin/SourceTableProClient";
import { requireRoutePermission } from "@/lib/route-access";

export default async function SourceTableDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ table: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoutePermission(["manage_settings"]);
  const { table } = await params;
  const sp = await searchParams;
  const initialSearch = typeof sp.search === "string" ? sp.search : "";
  const data = await listSourceTableDataAction(table as SourceTableId, { page: 1, limit: 15, search: initialSearch });
  if (!data) notFound();

  return (
    <div className="adm-source-page">
      <header className="adm-source-detail-head">
        <div>
          <Link href="/admin/source-tables" className="adm-source-back">
            ← חזרה לטבלאות מקור
          </Link>
          <h1>{data.titleHe}</h1>
          <p>ניהול נתונים, חיפוש, סינון, עריכה ופעולות.</p>
        </div>
      </header>
      <SourceTableProClient tableId={table as SourceTableId} initialData={data} initialSearch={initialSearch} />
    </div>
  );
}
