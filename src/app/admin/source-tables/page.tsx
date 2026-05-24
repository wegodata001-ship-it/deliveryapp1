import { Suspense } from "react";
import { SourceTablesCards } from "@/components/admin/SourceTablesCards";
import { SourceTablesCardsSkeleton } from "@/components/admin/SourceTablesCardsSkeleton";
import { requireRoutePermission } from "@/lib/route-access";

export default async function SourceTablesPage() {
  await requireRoutePermission(["manage_settings"]);

  return (
    <div className="adm-source-page">
      <header className="adm-source-head">
        <h1>טבלאות מקור</h1>
        <p>גישה ברורה לטבלאות השוטפות וטבלאות המערכת, בעיצוב מודרני ונוח.</p>
      </header>

      <Suspense fallback={<SourceTablesCardsSkeleton />}>
        <SourceTablesCards />
      </Suspense>
    </div>
  );
}
