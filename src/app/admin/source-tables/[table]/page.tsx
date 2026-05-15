import Link from "next/link";
import { notFound } from "next/navigation";
import { getSourceTableShellMeta } from "@/app/admin/source-tables/actions";
import { PaymentChecksTableClient } from "@/components/admin/PaymentChecksTableClient";
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
  const shell = await getSourceTableShellMeta(table);
  if (!shell) notFound();

  const isPaymentChecks = shell.id === "payment-checks";

  return (
    <div className="adm-source-page">
      <header className="adm-source-detail-head">
        <div>
          <Link href="/admin/source-tables" className="adm-source-back">
            ← חזרה לטבלאות מקור
          </Link>
          <h1>{shell.titleHe}</h1>
          <p>{isPaymentChecks ? "ניהול צ׳יקים, סינון מתקדם וסטטוס הפקדה." : "ניהול נתונים, חיפוש, סינון, עריכה ופעולות."}</p>
        </div>
      </header>
      {isPaymentChecks ? (
        <PaymentChecksTableClient />
      ) : (
        <SourceTableProClient tableId={shell.id} initialData={null} initialSearch={initialSearch} />
      )}
    </div>
  );
}

