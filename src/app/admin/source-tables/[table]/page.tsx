import Link from "next/link";
import { notFound } from "next/navigation";
import { getSourceTableShellMeta } from "@/app/admin/source-tables/actions";
import { SourceTableDetailBody } from "@/components/admin/SourceTableDetailBody";
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
  const isStatuses = shell.id === "statuses";

  return (
    <div className="adm-source-page adm-page--page-scroll">
      <header className="adm-source-detail-head">
        <div>
          <Link href="/admin/source-tables" className="adm-source-back">
            ← חזרה לטבלאות מקור
          </Link>
          <h1>{shell.titleHe}</h1>
          <p>
            {isPaymentChecks
              ? "ניהול צ׳יקים, סינון מתקדם וסטטוס הפקדה."
              : isStatuses
                ? "טבלת סטטוסי הזמנה — מקור הנתונים לכל dropdown במערכת."
                : shell.id === "customers"
                  ? "רשימת לקוחות עם עימוד, KPI, תצוגה מקדימה וייצוא."
                  : shell.id === "orders"
                    ? "רשימת הזמנות מהירה — עימוד ללא COUNT, KPI במטמון, תצוגה מקדימה וייצוא."
                    : shell.id === "payments"
                      ? "רשימת תשלומים — KPI, סינון, תצוגה מקדימה, ייצוא ופתיחת קליטת תשלום."
                        : shell.id === "payment-fees"
                        ? "עמלות והפרשי התאמה מתשלומים — סינון, חיפוש וייצוא."
                        : shell.id === "cash-flow"
                        ? "בקרת תזרים שבועית — כל השבועות, רכישות מט״ח, העברות לטורקיה ויתרות קופה."
                      : shell.id === "employees"
                        ? "ניהול עובדים — KPI, סינון, פעולות, ייצוא ועריכה במערכת הקיימת."
                        : shell.id === "payment-methods"
                          ? "אמצעי תשלום — KPI, סוגים, שימושים, סינון, ייצוא ועריכה."
                          : "ניהול נתונים, חיפוש, סינון, עריכה ופעולות."}
          </p>
        </div>
      </header>
      <SourceTableDetailBody tableId={shell.id} initialSearch={initialSearch} />
    </div>
  );
}
