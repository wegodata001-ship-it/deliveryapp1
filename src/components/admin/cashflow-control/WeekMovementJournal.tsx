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
  compact = false,
}: {
  entries: WeekMovementJournalEntry[];
  weekCode: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const wrapClass = compact ? "cfc-journal cfc-journal--compact" : "cfc-journal";

  if (loading) {
    return (
      <section className={wrapClass} aria-label="יומן תנועות">
        {!compact ? (
          <header className="cfc-journal__head">
            <h2>יומן תנועות השבוע</h2>
            <p dir="ltr">{weekCode}</p>
          </header>
        ) : null}
        <div className="cfc-journal__skeleton" aria-hidden="true">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="cfc-journal__skeleton-row" />
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={wrapClass} aria-label="יומן תנועות">
        <div className="cfc-journal__empty cfc-journal__empty--error">
          <p>{error}</p>
          {onRetry ? (
            <button type="button" className="cfc-btn cfc-btn--ghost cfc-btn--sm" onClick={onRetry}>
              נסה שוב
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (entries.length === 0) {
    return (
      <section className={wrapClass} aria-label="יומן תנועות">
        <p className="cfc-empty cfc-empty--inline">אין תנועות בשבוע הנבחר</p>
      </section>
    );
  }

  return (
    <section className={wrapClass} aria-label="יומן תנועות">
      {!compact ? (
        <header className="cfc-journal__head">
          <h2>יומן תנועות השבוע</h2>
          <p>
            מקור ההסבר למספרים למעלה · <span dir="ltr">{weekCode}</span>
          </p>
        </header>
      ) : null}
      <div className="cfc-journal__wrap">
        <table className="cfc-journal__table cfc-compact-table">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>שבוע</th>
              <th>סוג</th>
              <th>מסלול</th>
              <th>מקור</th>
              <th className="cfc-num">סכום</th>
              <th>מטבע</th>
              <th>אסמכתא</th>
              <th>מבצע</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const outAmt =
                e.outIls != null ? e.outIls : e.outUsd != null ? e.outUsd : null;
              const outCur: "ILS" | "USD" | null =
                e.outIls != null ? "ILS" : e.outUsd != null ? "USD" : null;
              const inAmt = e.inIls != null ? e.inIls : e.inUsd != null ? e.inUsd : null;
              const inCur: "ILS" | "USD" | null =
                e.inIls != null ? "ILS" : e.inUsd != null ? "USD" : null;
              const amt = inAmt ?? outAmt;
              const cur = inCur ?? outCur;
              const track =
                e.source.includes("IL") || e.target.includes("IL") || e.kindLabel.includes("IL")
                  ? "IL"
                  : "PS";
              return (
                <tr key={e.id} className={rowClass(e.color)}>
                  <td>{e.date}</td>
                  <td dir="ltr">{weekCode}</td>
                  <td>
                    {e.kindLabel}
                    {e.isConversion ? (
                      <span className="cfc-journal__tag" title="המרת נכס">
                        המרה
                      </span>
                    ) : null}
                  </td>
                  <td>{track}</td>
                  <td>{e.source}</td>
                  <td dir="ltr" className="cfc-num">
                    {amt != null && cur ? fmtCell(cur, amt) : "—"}
                  </td>
                  <td>{cur ?? "—"}</td>
                  <td>{e.notes ?? e.target ?? "—"}</td>
                  <td>{e.actor ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
