"use client";

import type { WeekMovementJournalEntry } from "@/lib/flow-control/services/week-movement-journal.shared";
import { fmtDailyMoney } from "@/lib/cash-control-daily";

function fmtCell(currency: "ILS" | "USD", n: number | null): string {
  if (n == null || n <= 0.005) return "—";
  return fmtDailyMoney(currency, n);
}

function rowClass(color: WeekMovementJournalEntry["color"]): string {
  switch (color) {
    case "in":
      return "cfc-journal__row--in";
    case "out":
      return "cfc-journal__row--out";
    case "transfer":
      return "cfc-journal__row--transfer";
    case "alert":
      return "cfc-journal__row--alert";
  }
}

export function WeekMovementJournal({
  entries,
  weekCode,
  loading,
  error,
  onRetry,
}: {
  entries: WeekMovementJournalEntry[];
  weekCode: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <section className="cfc-journal" aria-label="יומן תנועות">
        <header className="cfc-journal__head">
          <h2>יומן תנועות השבוע</h2>
          <p dir="ltr">{weekCode}</p>
        </header>
        <div className="cfc-journal__skeleton" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="cfc-journal__skeleton-row" />
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="cfc-journal" aria-label="יומן תנועות">
        <header className="cfc-journal__head">
          <h2>יומן תנועות השבוע</h2>
          <p dir="ltr">{weekCode}</p>
        </header>
        <div className="cfc-journal__empty cfc-journal__empty--error">
          <p>{error}</p>
          {onRetry ? (
            <button type="button" className="cfc-btn cfc-btn--ghost" onClick={onRetry}>
              נסה שוב
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (entries.length === 0) {
    return (
      <section className="cfc-journal" aria-label="יומן תנועות">
        <header className="cfc-journal__head">
          <h2>יומן תנועות השבוע</h2>
          <p dir="ltr">{weekCode}</p>
        </header>
        <p className="cfc-journal__empty">אין תנועות רשומות בשבוע זה</p>
      </section>
    );
  }

  return (
    <section className="cfc-journal" aria-label="יומן תנועות">
      <header className="cfc-journal__head">
        <h2>יומן תנועות השבוע</h2>
        <p>
          מקור ההסבר למספרים למעלה · <span dir="ltr">{weekCode}</span>
        </p>
      </header>
      <div className="cfc-journal__wrap">
        <table className="cfc-journal__table">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>סוג תנועה</th>
              <th>מקור</th>
              <th>יעד</th>
              <th className="cfc-num">יצא</th>
              <th className="cfc-num">נכנס</th>
              <th className="cfc-num">שער</th>
              <th>מבצע</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className={rowClass(e.color)}>
                <td>{e.date}</td>
                <td>
                  {e.kindLabel}
                  {e.isConversion ? (
                    <span className="cfc-journal__tag" title="המרת נכס">
                      המרה
                    </span>
                  ) : null}
                </td>
                <td>{e.source}</td>
                <td>{e.target}</td>
                <td dir="ltr" className="cfc-num">
                  {e.outIls != null
                    ? fmtCell("ILS", e.outIls)
                    : e.outUsd != null
                      ? fmtCell("USD", e.outUsd)
                      : "—"}
                </td>
                <td dir="ltr" className="cfc-num">
                  {e.inIls != null
                    ? fmtCell("ILS", e.inIls)
                    : e.inUsd != null
                      ? fmtCell("USD", e.inUsd)
                      : "—"}
                </td>
                <td dir="ltr" className="cfc-num">
                  {e.rate != null && e.rate > 0 ? e.rate.toFixed(4) : "—"}
                </td>
                <td>{e.actor ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
