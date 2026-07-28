"use client";

import { useState } from "react";
import { Upload, X } from "lucide-react";
import * as XLSX from "xlsx";
import type {
  LocationAliasImportPreview,
  LocationAliasImportResult,
} from "@/app/admin/shipments/location-service";
import {
  commitLocationAliasRowsAction,
  previewLocationAliasImportAction,
} from "@/app/admin/shipments/location-actions";

type Props = {
  onClose: () => void;
  onDone?: (result: LocationAliasImportResult) => void;
};

export function LocationAliasImportModal({ onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<LocationAliasImportPreview | null>(null);

  async function onImportFile(file: File) {
    setBusy(true);
    setMsg(null);
    setPreview(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const res = await previewLocationAliasImportAction(grid);
      if (res.ok) setPreview(res.preview);
      else setMsg(res.error);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commitImport() {
    if (!preview) return;
    if (preview.mappingError) {
      setMsg(preview.mappingError);
      return;
    }
    const rows = preview.rows.filter((r) => r.valid);
    if (rows.length === 0) {
      setMsg("אין שורות תקינות — בדקו כותרות: מקום מסירה | אזור חלוקה | מקום מסירה מעודכן");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await commitLocationAliasRowsAction(rows, preview.totalRows);
      if (res.ok) {
        onDone?.(res.result);
        onClose();
      } else setMsg(res.error);
    } catch (e) {
      setMsg(`הייבוא נכשל: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shp-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="shp-modal" style={{ maxWidth: 900, width: "96vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="shp-modal__header">
          <strong>ייבוא התאמות יישובים</strong>
          <button type="button" className="shp-icon-btn" onClick={onClose} disabled={busy}>
            <X size={16} />
          </button>
        </div>
        <div className="shp-modal__body" style={{ display: "grid", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
            סדר עמודות: <strong>מקום מסירה מקורי</strong> · <strong>אזור חלוקה</strong> ·{" "}
            <strong>מקום מסירה מעודכן</strong>
          </p>
          <label className="shp-btn shp-btn--primary" style={{ display: "inline-flex", cursor: "pointer", width: "fit-content" }}>
            <Upload size={14} />
            בחר קובץ Excel
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {msg && <div className="shp-alert shp-alert--error">{msg}</div>}
          {preview?.mappingError && (
            <div className="shp-alert shp-alert--error">{preview.mappingError}</div>
          )}
          {preview && !preview.mappingError && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13 }}>
                <span>שורת כותרות: {preview.headerRowIndex + 1}</span>
                <span>סה״כ {preview.totalRows}</span>
                <span>תקינות {preview.validRows}</span>
                <span>חדשות {preview.wouldCreateAliases}</span>
                <span>עודכנו {preview.wouldUpdateAliases}</span>
                <span>נכשלו {preview.invalidRows}</span>
              </div>
              <div className="shp-daily-wrap" style={{ maxHeight: 280 }}>
                <table className="shp-table shp-table--daily">
                  <thead>
                    <tr>
                      <th>מקום מסירה מקורי</th>
                      <th>מקום מסירה מעודכן</th>
                      <th>אזור חלוקה</th>
                      <th>מצב</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 12).map((r) => (
                      <tr key={r.rowIndex}>
                        <td>{r.originalName || "—"}</td>
                        <td
                          style={{
                            color: r.displayName && /^(צפון|דרום|מרכז|משולש)/.test(r.displayName)
                              ? "#b91c1c"
                              : undefined,
                            fontWeight: 600,
                          }}
                        >
                          {r.displayName || "—"}
                        </td>
                        <td>{r.areaName || "—"}</td>
                        <td style={{ color: r.valid ? "#15803d" : "#b91c1c" }}>
                          {r.valid ? "תקין" : r.error || "שגיאה"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={
              busy || !preview || !!preview.mappingError || preview.validRows === 0
            }
            onClick={() => void commitImport()}
          >
            {busy ? "מייבא..." : "אשר ייבוא"}
          </button>
        </div>
      </div>
    </div>
  );
}
