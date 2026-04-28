import Link from "next/link";
import { listSourceTableCardsAction } from "@/app/admin/source-tables/actions";
import { requireRoutePermission } from "@/lib/route-access";

export default async function SourceTablesPage() {
  await requireRoutePermission(["manage_settings"]);
  const cards = await listSourceTableCardsAction();
  const running = cards.filter((c) => c.group === "running");
  const system = cards.filter((c) => c.group === "system");

  return (
    <div className="adm-source-page">
      <header className="adm-source-head">
        <h1>טבלאות מקור</h1>
        <p>גישה ברורה לטבלאות השוטפות וטבלאות המערכת, בעיצוב מודרני ונוח.</p>
      </header>

      <section className="adm-source-section adm-source-section--running">
        <div className="adm-source-section-head">
          <h2>טבלאות שוטפות</h2>
          <span>{running.length} טבלאות</span>
        </div>
        <div className="adm-source-grid">
          {running.map((card) => (
            <Link key={card.id} href={`/admin/source-tables/${card.id}`} className="adm-source-card adm-source-card--running">
              <span className="adm-source-icon" aria-hidden>{card.icon}</span>
              <div>
                <h3>{card.titleHe}</h3>
                <p>{card.description}</p>
              </div>
              <span className="adm-source-count">{card.count ?? "—"}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="adm-source-section adm-source-section--system">
        <div className="adm-source-section-head">
          <h2>טבלאות מערכת</h2>
          <span>{system.length} טבלאות</span>
        </div>
        <div className="adm-source-grid">
          {system.map((card) => (
            <Link key={card.id} href={`/admin/source-tables/${card.id}`} className="adm-source-card adm-source-card--system">
              <span className="adm-source-icon" aria-hidden>{card.icon}</span>
              <div>
                <h3>{card.titleHe}</h3>
                <p>{card.description}</p>
              </div>
              <span className="adm-source-count">{card.count ?? "—"}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
