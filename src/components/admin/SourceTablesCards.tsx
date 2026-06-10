import Link from "next/link";
import { listSourceTableCardCountsAction } from "@/app/admin/source-tables/actions";
import { adminSourceTableHref } from "@/lib/admin-href";
import { SOURCE_TABLE_DEFINITIONS, type SourceTableCardDefinition } from "@/lib/source-table-definitions";
import { SourceTableIcon } from "@/components/admin/SourceTableIcon";

function cardClass(card: SourceTableCardDefinition): string {
  if (card.id === "payment-checks") return "adm-source-card adm-source-card--checks";
  if (card.group === "finance") return "adm-source-card adm-source-card--finance";
  if (card.group === "system") return "adm-source-card adm-source-card--system";
  return "adm-source-card adm-source-card--running";
}

function SourceTableSection({
  title,
  group,
  counts,
  searchParams,
}: {
  title: string;
  group: SourceTableCardDefinition["group"];
  counts: Record<string, number | null>;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const cards = SOURCE_TABLE_DEFINITIONS.filter((c) => c.group === group);
  const sectionClass =
    group === "finance"
      ? "adm-source-section adm-source-section--finance"
      : group === "system"
        ? "adm-source-section adm-source-section--system"
        : "adm-source-section adm-source-section--running";

  return (
    <section className={sectionClass}>
      <div className="adm-source-section-head">
        <h2>{title}</h2>
        <span>{cards.length} טבלאות</span>
      </div>
      <div className="adm-source-grid">
        {cards.map((card) => (
          <Link key={card.id} href={adminSourceTableHref(card.id, searchParams)} className={cardClass(card)}>
            <span className="adm-source-icon" aria-hidden>
              <SourceTableIcon icon={card.icon} />
            </span>
            <div>
              <h3>{card.titleHe}</h3>
              <p>{card.description}</p>
            </div>
            <div className="adm-source-count-wrap">
              {card.countLabel ? <span className="adm-source-count-lbl">{card.countLabel}</span> : null}
              <span className="adm-source-count">{counts[card.id] ?? "—"}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** כרטיסי טבלאות מקור — counts נטענים async (Suspense) */
export async function SourceTablesCards({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const counts = await listSourceTableCardCountsAction();

  return (
    <>
      <SourceTableSection title="טבלאות שוטפות" group="running" counts={counts} searchParams={searchParams} />
      <SourceTableSection title="טבלאות כספים" group="finance" counts={counts} searchParams={searchParams} />
      <SourceTableSection title="טבלאות מערכת" group="system" counts={counts} searchParams={searchParams} />
    </>
  );
}
