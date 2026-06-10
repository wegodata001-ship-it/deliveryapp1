import { SOURCE_TABLE_DEFINITIONS } from "@/lib/source-table-definitions";
import { SourceTableIcon } from "@/components/admin/SourceTableIcon";

function SectionSkeleton({ group, title }: { group: "running" | "finance" | "system"; title: string }) {
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
          <div key={card.id} className="adm-source-card adm-source-card--skeleton" aria-hidden>
            <span className="adm-source-icon">
              <SourceTableIcon icon={card.icon} />
            </span>
            <div>
              <h3>{card.titleHe}</h3>
              <p>{card.description}</p>
            </div>
            <div className="adm-source-count-wrap">
              <span className="adm-source-shim adm-source-shim--count" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SourceTablesCardsSkeleton() {
  return (
    <>
      <SectionSkeleton group="running" title="טבלאות שוטפות" />
      <SectionSkeleton group="finance" title="טבלאות כספים" />
      <SectionSkeleton group="system" title="טבלאות מערכת" />
    </>
  );
}
