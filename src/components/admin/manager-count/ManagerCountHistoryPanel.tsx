"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { getManagerCountHistoryAction } from "@/app/admin/cash-flow/get-manager-count-history-action";
import type { ManagerCountHistoryEntry } from "@/lib/flow-control/manager-count-history";
import type { WorkCountryCode } from "@/lib/work-country";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function diffKeys(before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    if ((before[k] ?? "") !== (after[k] ?? "")) changed.push(k);
  }
  return changed;
}

export function ManagerCountHistoryPanel({
  week,
  workCountry,
}: {
  week: string;
  workCountry: WorkCountryCode;
}) {
  const [entries, setEntries] = useState<ManagerCountHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getManagerCountHistoryAction({ week, workCountry }).then((res) => {
      if (cancelled) return;
      if (res.ok) setEntries([...res.entries].reverse());
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [week, workCountry]);

  return (
    <section className="mcw-history" aria-label="היסטוריית ספירות">
      <h3 className="mcw-history__title">
        <History size={16} aria-hidden /> היסטוריית ספירות
      </h3>
      {loading ? <p className="mcw-hint">טוען…</p> : null}
      {!loading && entries.length === 0 ? (
        <p className="mcw-hint">אין שמירות קודמות לשבוע זה</p>
      ) : null}
      <ul className="mcw-history__list">
        {entries.map((e) => {
          const changed = diffKeys(e.formBefore, e.formAfter);
          return (
            <li key={e.id} className="mcw-history__item">
              <div className="mcw-history__meta">
                <time dateTime={e.savedAt}>{fmtWhen(e.savedAt)}</time>
                {e.savedByName ? <span>{e.savedByName}</span> : null}
              </div>
              {changed.length ? (
                <ul className="mcw-history__changes">
                  {changed.map((k) => (
                    <li key={k}>
                      <code>{k}</code>: {e.formBefore[k] || "—"} → {e.formAfter[k] || "—"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mcw-hint">שמירה (ללא שינוי בשדות)</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
