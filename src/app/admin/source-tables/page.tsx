import Link from "next/link";
import { listSourceTableCardsAction } from "@/app/admin/source-tables/actions";
import { requireRoutePermission } from "@/lib/route-access";

export default async function SourceTablesPage() {
  await requireRoutePermission(["manage_settings"]);
  const cards = await listSourceTableCardsAction();
  const running = cards.filter((c) => c.group === "running");
  const finance = cards.filter((c) => c.group === "finance");
  const system = cards.filter((c) => c.group === "system");

  function cardClass(card: (typeof cards)[number]): string {
    if (card.id === "payment-checks") return "adm-source-card adm-source-card--checks";
    if (card.group === "finance") return "adm-source-card adm-source-card--finance";
    if (card.group === "system") return "adm-source-card adm-source-card--system";
    return "adm-source-card adm-source-card--running";
  }

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
            <Link key={card.id} href={`/admin/source-tables/${card.id}`} className={cardClass(card)}>
              <span className="adm-source-icon" aria-hidden>
                {card.icon}
              </span>
              <div>
                <h3>{card.titleHe}</h3>
                <p>{card.description}</p>
              </div>
              <div className="adm-source-count-wrap">
                {card.countLabel ? <span className="adm-source-count-lbl">{card.countLabel}</span> : null}
                <span className="adm-source-count">{card.count ?? "—"}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="adm-source-section adm-source-section--finance">
        <div className="adm-source-section-head">
          <h2>טבלאות כספים</h2>
          <span>{finance.length} טבלאות</span>
        </div>
        <div className="adm-source-grid">
          {finance.map((card) => (
            <Link key={card.id} href={`/admin/source-tables/${card.id}`} className={cardClass(card)}>
              <span className="adm-source-icon" aria-hidden>
                {card.icon}
              </span>
              <div>
                <h3>{card.titleHe}</h3>
                <p>{card.description}</p>
              </div>
              <div className="adm-source-count-wrap">
                {card.countLabel ? <span className="adm-source-count-lbl">{card.countLabel}</span> : null}
                <span className="adm-source-count">{card.count ?? "—"}</span>
              </div>
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
            <Link key={card.id} href={`/admin/source-tables/${card.id}`} className={cardClass(card)}>
              <span className="adm-source-icon" aria-hidden>
                {card.icon}
              </span>
              <div>
                <h3>{card.titleHe}</h3>
                <p>{card.description}</p>
              </div>
              <div className="adm-source-count-wrap">
                {card.countLabel ? <span className="adm-source-count-lbl">{card.countLabel}</span> : null}
                <span className="adm-source-count">{card.count ?? "—"}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
