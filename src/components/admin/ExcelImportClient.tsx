"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminLoading } from "@/components/admin/AdminLoadingProvider";

type PreviewRow = {
  id: string;
  rowNumber: number;
  name: string | null;
  phone: string | null;
  city: string | null;
  boxes: number | null;
  weight: string | null;
  amountLeft: string | null;
  amountRight: string | null;
  notes: string | null;
  status: "VALID" | "ERROR" | "IMPORTED";
  errorMessage: string | null;
};

type PreviewFile = {
  id: string;
  fileName: string | null;
  shipmentNumber: string | null;
  sendDate: string | null;
  arrivalDate: string | null;
  totalWeight: number | null;
  totalBoxes: number | null;
  status: "draft" | "imported";
  fileMeta?: Record<string, unknown>;
};

type HeaderDraft = {
  shipmentNumber: string;
  sendDate: string;
  arrivalDate: string;
  totalWeight: string;
  totalBoxes: string;
};

type UploadResp = {
  ok: boolean;
  error?: string;
  file?: PreviewFile;
  counts?: { valid: number; error: number };
  rows?: PreviewRow[];
};

type ImportHistoryItem = {
  id: string;
  fileName: string | null;
  createdAt: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  status: string;
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short" }).format(d);
}

export function ExcelImportClient() {
  const PAGE_SIZE = 100;
  const { runWithLoading } = useAdminLoading();
  const [file, setFile] = useState<File | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [editRows, setEditRows] = useState<Record<string, PreviewRow>>({});
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const [headerDraft, setHeaderDraft] = useState<HeaderDraft>({
    shipmentNumber: "",
    sendDate: "",
    arrivalDate: "",
    totalWeight: "",
    totalBoxes: "",
  });
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});

  const validCount = useMemo(() => rows.filter((r) => r.status === "VALID").length, [rows]);
  const errorCount = useMemo(() => rows.filter((r) => r.status === "ERROR").length, [rows]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), [rows.length]);
  const selectedCount = useMemo(() => rows.filter((r) => selectedRowIds[r.id]).length, [rows, selectedRowIds]);
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  async function onUpload() {
    if (!file) {
      setErr("יש לבחור קובץ Excel");
      return;
    }
    setErr(null);
    setDoneMsg(null);
    setBusy(true);
    setIsScanning(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const payload = await runWithLoading(
        async () => {
          const res = await fetch("/api/excel/upload", { method: "POST", body: fd });
          return (await res.json()) as UploadResp;
        },
        "סורק קובץ...",
      );
      if (!payload.ok || !payload.file) {
        setErr(payload.error || "שגיאה בסריקת קובץ");
        return;
      }
      // Give React an event loop turn before committing heavy table state.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      setPreviewFile(payload.file);
      setHeaderDraft({
        shipmentNumber: payload.file.shipmentNumber || "",
        sendDate: payload.file.sendDate || "",
        arrivalDate: payload.file.arrivalDate || "",
        totalWeight: payload.file.totalWeight == null ? "" : String(payload.file.totalWeight),
        totalBoxes: payload.file.totalBoxes == null ? "" : String(payload.file.totalBoxes),
      });
      const nextRows = payload.rows || [];
      setRows(nextRows);
      setEditRows(Object.fromEntries(nextRows.map((r) => [r.id, r])));
      setSelectedRowIds(Object.fromEntries(nextRows.map((r) => [r.id, r.status === "VALID"])));
      setPage(1);
      void loadHistory();
      setDoneMsg("✔ הקובץ נסרק בהצלחה");
    } catch {
      setErr("❌ שגיאה בביצוע פעולה");
    } finally {
      setIsScanning(false);
      setBusy(false);
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch("/api/excel/history");
      const payload = (await res.json()) as { ok: boolean; imports?: ImportHistoryItem[] };
      if (payload.ok) setHistory(payload.imports || []);
    } catch {
      // keep screen usable even if history fails
    }
  }

  async function viewImport(importId: string) {
    setBusy(true);
    setErr(null);
    try {
      const payload = await runWithLoading(
        async () => {
          const res = await fetch(`/api/excel/history?importId=${encodeURIComponent(importId)}`);
          return (await res.json()) as { ok: boolean; file?: PreviewFile; rows?: PreviewRow[]; error?: string };
        },
        "טוען נתונים...",
      );
      if (!payload.ok || !payload.file) {
        setErr(payload.error || "שגיאה בטעינת ייבוא");
        return;
      }
      const nextRows = payload.rows || [];
      setPreviewFile(payload.file);
      setHeaderDraft({
        shipmentNumber: payload.file.shipmentNumber || "",
        sendDate: payload.file.sendDate || "",
        arrivalDate: payload.file.arrivalDate || "",
        totalWeight: payload.file.totalWeight == null ? "" : String(payload.file.totalWeight),
        totalBoxes: payload.file.totalBoxes == null ? "" : String(payload.file.totalBoxes),
      });
      setRows(nextRows);
      setEditRows(Object.fromEntries(nextRows.map((r) => [r.id, r])));
      setSelectedRowIds(Object.fromEntries(nextRows.map((r) => [r.id, r.status === "VALID"])));
      setPage(1);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmImport(mode: "valid_only" | "all" | "selected") {
    if (!previewFile?.id) return;
    setErr(null);
    setDoneMsg(null);
    setBusy(true);
    try {
      const payload = await runWithLoading(
        async () => {
          const res = await fetch("/api/excel/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileId: previewFile.id,
              mode,
              rowIds: mode === "selected" ? rows.filter((r) => selectedRowIds[r.id]).map((r) => r.id) : undefined,
            }),
          });
          return (await res.json()) as { ok: boolean; error?: string; imported?: number; failed?: number; importedRowIds?: string[] };
        },
        "מבצע ייבוא נתונים...",
      );
      if (!payload.ok) {
        setErr(payload.error || "שגיאה באישור ייבוא");
        return;
      }
      const importedSet = new Set(payload.importedRowIds || []);
      setDoneMsg(`✔ הייבוא הושלם בהצלחה · יובאו ${payload.imported ?? 0} שורות`);
      setRows((old) => old.map((r) => (importedSet.has(r.id) ? { ...r, status: "IMPORTED" } : r)));
      void loadHistory();
    } catch {
      setErr("❌ שגיאה בביצוע פעולה");
    } finally {
      setBusy(false);
    }
  }

  async function saveHeaderMeta() {
    if (!previewFile?.id) return;
    setBusy(true);
    setErr(null);
    setDoneMsg(null);
    try {
      const payload = await runWithLoading(
        async () => {
          const res = await fetch("/api/excel/history", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              importId: previewFile.id,
              shipmentNumber: headerDraft.shipmentNumber || null,
              sendDate: headerDraft.sendDate || null,
              arrivalDate: headerDraft.arrivalDate || null,
              totalWeight: headerDraft.totalWeight ? Number(headerDraft.totalWeight) : null,
              totalBoxes: headerDraft.totalBoxes ? Number(headerDraft.totalBoxes) : null,
            }),
          });
          return (await res.json()) as { ok: boolean; error?: string };
        },
        "שומר נתונים...",
      );
      if (!payload.ok) {
        setErr(payload.error || "שגיאה בשמירת Header");
        return;
      }
      setPreviewFile((old) =>
        old
          ? {
              ...old,
              shipmentNumber: headerDraft.shipmentNumber || null,
              sendDate: headerDraft.sendDate || null,
              arrivalDate: headerDraft.arrivalDate || null,
              totalWeight: headerDraft.totalWeight ? Number(headerDraft.totalWeight) : null,
              totalBoxes: headerDraft.totalBoxes ? Number(headerDraft.totalBoxes) : null,
            }
          : old,
      );
      setDoneMsg("✔ Header נשמר ידנית");
      void loadHistory();
    } finally {
      setBusy(false);
    }
  }

  async function saveRow(id: string) {
    const row = editRows[id];
    if (!row) return;
    setBusy(true);
    setErr(null);
    try {
      const payload = await runWithLoading(
        async () => {
          const res = await fetch("/api/excel/row", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(row),
          });
          return (await res.json()) as { ok: boolean; status?: "VALID" | "ERROR"; errorMessage?: string | null; error?: string };
        },
        "שומר נתונים...",
      );
      if (!payload.ok) {
        setErr(payload.error || "שגיאה בשמירת שורה");
        return;
      }
      setRows((old) =>
        old.map((r) =>
          r.id === id
            ? { ...row, status: payload.status ?? row.status, errorMessage: payload.errorMessage ?? null }
            : r,
        ),
      );
      setDoneMsg("✔ הפעולה בוצעה בהצלחה");
    } catch {
      setErr("❌ שגיאה בביצוע פעולה");
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(id: string) {
    setBusy(true);
    setErr(null);
    try {
      const payload = await runWithLoading(
        async () => {
          const res = await fetch(`/api/excel/row?id=${encodeURIComponent(id)}`, { method: "DELETE" });
          return (await res.json()) as { ok: boolean; error?: string };
        },
        "שומר נתונים...",
      );
      if (!payload.ok) {
        setErr(payload.error || "שגיאה במחיקת שורה");
        return;
      }
      setRows((old) => old.filter((r) => r.id !== id));
      setEditRows((old) => {
        const next = { ...old };
        delete next[id];
        return next;
      });
      setDoneMsg("✔ שורה נמחקה");
      void loadHistory();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  return (
    <div className="adm-excel-page">
      <section className="adm-excel-upload-card">
        <h1>ייבוא Excel</h1>
        <p>העלה קובץ, בדוק Preview ורק אז אשר ייבוא לטבלאות האמיתיות.</p>
        <div className="adm-excel-actions">
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button type="button" className="adm-btn adm-btn--primary" disabled={busy || !file} onClick={() => void onUpload()}>
            {busy ? "⏳ סורק..." : "סריקת קובץ"}
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--excel-primary"
            disabled={busy || !previewFile || validCount === 0}
            onClick={() => void onConfirmImport("valid_only")}
          >
            {busy ? "⏳ מייבא..." : "ייבא שורות תקינות בלבד"}
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--excel-warning"
            disabled={busy || !previewFile || rows.length === 0}
            onClick={() => void onConfirmImport("all")}
          >
            {busy ? "⏳ מייבא..." : "ייבא הכל (כולל שגיאות)"}
          </button>
          <button
            type="button"
            className="adm-btn adm-btn--ghost"
            disabled={busy || !previewFile || selectedCount === 0}
            onClick={() => void onConfirmImport("selected")}
          >
            {busy ? "⏳ מייבא..." : `ייבא מסומנות בלבד (${selectedCount})`}
          </button>
        </div>
        {doneMsg ? <div className="adm-settings-toast">{doneMsg}</div> : null}
        {err ? <div className="adm-error">{err}</div> : null}
      </section>

      {previewFile ? (
        <section className="adm-excel-meta-card">
          <h2>📦 פרטי קובץ</h2>
          <div className="adm-excel-meta-grid">
            <div>
              <strong>מספר משלוח:</strong>
              <input
                value={headerDraft.shipmentNumber}
                disabled={busy}
                onChange={(e) => setHeaderDraft((old) => ({ ...old, shipmentNumber: e.target.value }))}
              />
            </div>
            <div><strong>שם קובץ:</strong> {previewFile.fileName || "—"}</div>
            <div>
              <strong>תאריך שליחה:</strong>
              <input
                type="date"
                value={headerDraft.sendDate ? new Date(headerDraft.sendDate).toISOString().slice(0, 10) : ""}
                disabled={busy}
                onChange={(e) =>
                  setHeaderDraft((old) => ({
                    ...old,
                    sendDate: e.target.value ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString() : "",
                  }))
                }
              />
            </div>
            <div>
              <strong>תאריך הגעה:</strong>
              <input
                type="date"
                value={headerDraft.arrivalDate ? new Date(headerDraft.arrivalDate).toISOString().slice(0, 10) : ""}
                disabled={busy}
                onChange={(e) =>
                  setHeaderDraft((old) => ({
                    ...old,
                    arrivalDate: e.target.value ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString() : "",
                  }))
                }
              />
            </div>
            <div>
              <strong>סה"כ משקל:</strong>
              <input
                dir="ltr"
                value={headerDraft.totalWeight}
                disabled={busy}
                onChange={(e) => setHeaderDraft((old) => ({ ...old, totalWeight: e.target.value }))}
              />
            </div>
            <div>
              <strong>סה"כ קרטונים:</strong>
              <input
                dir="ltr"
                value={headerDraft.totalBoxes}
                disabled={busy}
                onChange={(e) => setHeaderDraft((old) => ({ ...old, totalBoxes: e.target.value }))}
              />
            </div>
            <div><strong>סטטוס ייבוא:</strong> {previewFile.status}</div>
          </div>
          <div className="adm-excel-actions" style={{ marginTop: 8 }}>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => void saveHeaderMeta()}>
              שמור Header ידנית
            </button>
            <span style={{ fontSize: 12, opacity: 0.8 }}>מיועד לתיקון שורות 1–4 כשזיהוי אוטומטי לא מדויק</span>
          </div>
          <div className="adm-excel-counters">
            <span className="adm-excel-valid">✔ שורות תקינות: {validCount}</span>
            <span className="adm-excel-error">❌ שורות עם שגיאה: {errorCount}</span>
            <span>סה״כ שורות: {rows.length}</span>
          </div>
          <p className="adm-excel-hint">{`${rows.length} שורות נקלטו בהצלחה`}</p>
          <p className="adm-excel-hint">{`${errorCount} שורות דורשות בדיקה`}</p>
          <p className="adm-excel-hint">
            ניתן לייבא גם עם שגיאות. שורות לא תקינות יסומנו וניתן לערוך לאחר מכן.
          </p>
        </section>
      ) : null}

      <section className="adm-excel-meta-card">
        <h2>היסטוריית ייבוא</h2>
        {history.length === 0 ? (
          <div className="adm-table-empty">אין היסטוריית ייבוא</div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>קובץ</th>
                <th>תאריך</th>
                <th>שורות</th>
                <th>תקינות</th>
                <th>שגויות</th>
                <th>פעולה</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.fileName || "—"}</td>
                  <td>{fmtDate(h.createdAt)}</td>
                  <td>{h.totalRows}</td>
                  <td>{h.validRows}</td>
                  <td>{h.invalidRows}</td>
                  <td>
                    <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => void viewImport(h.id)}>
                      צפייה
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="adm-excel-table-wrap">
        {isScanning ? (
          <div className="adm-table-empty">⏳ סורק קובץ... נא להמתין</div>
        ) : (
          <>
            <table className="adm-table adm-excel-table">
              <thead>
                <tr>
                  <th>בחירה</th>
                  <th>שורה</th>
                  <th>שם</th>
                  <th>טלפון</th>
                  <th>עיר</th>
                  <th>קרטונים</th>
                  <th>משקל</th>
                  <th>סכום שמאלי</th>
                  <th>סכום ימני</th>
                  <th>הערות</th>
                  <th>סטטוס</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="adm-table-empty">אין Preview להצגה</td>
                  </tr>
                ) : (
                  pageRows.map((r) => {
                    const e = editRows[r.id] ?? r;
                    return (
                    <tr
                      key={r.id}
                      className={
                        r.status === "ERROR"
                          ? "adm-excel-row--error"
                          : r.status === "VALID"
                            ? "adm-excel-row--valid"
                            : "adm-excel-row--warning"
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={!!selectedRowIds[r.id]}
                          disabled={busy || r.status === "IMPORTED"}
                          onChange={(ev) =>
                            setSelectedRowIds((old) => ({
                              ...old,
                              [r.id]: ev.target.checked,
                            }))
                          }
                        />
                      </td>
                      <td>{r.rowNumber}</td>
                      <td><input value={e.name || ""} onChange={(ev) => setEditRows((old) => ({ ...old, [r.id]: { ...e, name: ev.target.value || null } }))} /></td>
                      <td><input dir="ltr" value={e.phone || ""} onChange={(ev) => setEditRows((old) => ({ ...old, [r.id]: { ...e, phone: ev.target.value || null } }))} /></td>
                      <td><input value={e.city || ""} onChange={(ev) => setEditRows((old) => ({ ...old, [r.id]: { ...e, city: ev.target.value || null } }))} /></td>
                      <td><input dir="ltr" value={e.boxes || ""} onChange={(ev) => setEditRows((old) => ({ ...old, [r.id]: { ...e, boxes: ev.target.value ? Number(ev.target.value) : null } }))} /></td>
                      <td><input dir="ltr" value={e.weight || ""} onChange={(ev) => setEditRows((old) => ({ ...old, [r.id]: { ...e, weight: ev.target.value || null } }))} /></td>
                      <td><input dir="ltr" value={e.amountLeft || ""} onChange={(ev) => setEditRows((old) => ({ ...old, [r.id]: { ...e, amountLeft: ev.target.value || null } }))} /></td>
                      <td><input dir="ltr" value={e.amountRight || ""} onChange={(ev) => setEditRows((old) => ({ ...old, [r.id]: { ...e, amountRight: ev.target.value || null } }))} /></td>
                      <td><input value={e.notes || ""} onChange={(ev) => setEditRows((old) => ({ ...old, [r.id]: { ...e, notes: ev.target.value || null } }))} /></td>
                      <td>
                        {r.status === "VALID" ? "VALID" : r.status === "ERROR" ? `ERROR: ${r.errorMessage || ""}` : r.status}
                      </td>
                      <td>
                        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => void saveRow(r.id)}>
                          ערוך שורה
                        </button>
                        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" disabled={busy} onClick={() => void deleteRow(r.id)}>
                          מחק שורה
                        </button>
                      </td>
                    </tr>
                  );
                  })
                )}
              </tbody>
            </table>
            {rows.length > PAGE_SIZE ? (
              <div className="adm-excel-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  disabled={page <= 1 || busy}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  הקודם
                </button>
                <span>עמוד {page} / {totalPages}</span>
                <button
                  type="button"
                  className="adm-btn adm-btn--ghost adm-btn--sm"
                  disabled={page >= totalPages || busy}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  הבא
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

