"use client";

import { useCallback, useEffect, useState } from "react";

type ArchiveItem = {
  id: string;
  weekCode: string;
  version: number;
  createdAt: string;
  createdByName: string | null;
  hasPdf: boolean;
  hasExcel: boolean;
};

export function CashflowArchivePanel({ week, canSave }: { week: string; canSave: boolean }) {
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/controls/cash-flow/archive?week=${encodeURIComponent(week)}`);
    const body = (await res.json().catch(() => null)) as { ok?: boolean; items?: ArchiveItem[]; error?: string } | null;
    if (!res.ok || !body?.ok) {
      setMessage(body?.error ?? "הארכיון לא נטען");
      return;
    }
    setItems(body.items ?? []);
    setMessage(null);
  }, [week]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveVersion() {
    setBusy(true);
    try {
      const res = await fetch("/api/controls/cash-flow/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        version?: number;
        repeat?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        setMessage(body?.error ?? "שמירת הגרסה נכשלה");
        return;
      }
      setMessage(
        body.repeat
          ? `נשמרה גרסה ${body.version}. הגרסאות הקודמות לא השתנו.`
          : `נשמרה גרסה ${body.version}.`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  function download(id: string, format: "pdf" | "excel" | "json") {
    window.open(`/api/controls/cash-flow/archive/${id}?format=${format}`, "_blank", "noopener");
  }

  return (
    <details className="cfc-archive">
      <summary>ארכיון שבוע {week}</summary>
      <div className="cfc-archive__body">
        {canSave ? (
          <button type="button" className="cfc-btn cfc-btn--ghost" disabled={busy} onClick={() => void saveVersion()}>
            {busy ? "שומר…" : "שמירת גרסה"}
          </button>
        ) : null}
        {message ? <p className="cfc-archive__note">{message}</p> : null}
        {items.length === 0 ? (
          <p className="cfc-archive__note">אין מסמך שמור לשבוע הזה.</p>
        ) : (
          <ul className="cfc-archive__list">
            {items.map((item) => (
              <li key={item.id}>
                <span>
                  גרסה {item.version}
                  {item.createdByName ? ` · ${item.createdByName}` : ""}
                  {" · "}
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString("he-IL", { hour12: false })}
                  </time>
                </span>
                <span className="cfc-archive__actions">
                  <button type="button" onClick={() => download(item.id, "json")}>
                    פירוט
                  </button>
                  {item.hasExcel ? (
                    <button type="button" onClick={() => download(item.id, "excel")}>
                      Excel
                    </button>
                  ) : null}
                  {item.hasPdf ? (
                    <button type="button" onClick={() => download(item.id, "pdf")}>
                      PDF
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
