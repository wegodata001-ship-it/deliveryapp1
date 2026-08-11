"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { DeliveryLocationDto } from "@/app/admin/shipments/location-service";
import {
  addLocationAliasAction,
  deleteLocationAliasAction,
  updateLocationAliasOriginalNameAction,
} from "@/app/admin/shipments/location-actions";

type Props = {
  location: DeliveryLocationDto;
  onClose: () => void;
  onChanged: () => void;
};

export function LocationAliasesManageModal({ location, onClose, onChanged }: Props) {
  const [aliases, setAliases] = useState(location.aliases);
  const [newAlias, setNewAlias] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...aliases].sort((a, b) => a.originalName.localeCompare(b.originalName, "he")),
    [aliases],
  );

  async function onAdd() {
    const name = newAlias.trim();
    if (!name) {
      setError("יש להזין שם כינוי");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await addLocationAliasAction({
      deliveryLocationId: location.id,
      originalName: name,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAliases((prev) => {
      const idx = prev.findIndex((a) => a.id === res.row.aliasId);
      const next = [...prev];
      const entry = {
        id: res.row.aliasId,
        originalName: res.row.originalName,
        normalizedOriginalName: "",
        isActive: true,
      };
      if (idx >= 0) next[idx] = entry;
      else next.push(entry);
      return next;
    });
    setNewAlias("");
    onChanged();
  }

  async function onSaveEdit(aliasId: string) {
    const name = editValue.trim();
    if (!name) {
      setError("שם כינוי לא יכול להיות ריק");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await updateLocationAliasOriginalNameAction({ aliasId, originalName: name });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAliases((prev) =>
      prev.map((a) => (a.id === aliasId ? { ...a, originalName: res.row.originalName } : a)),
    );
    setEditingId(null);
    setEditValue("");
    onChanged();
  }

  async function onDelete(aliasId: string, label: string) {
    if (!window.confirm(`למחוק את הכינוי "${label}"?`)) return;
    setBusy(true);
    setError(null);
    const res = await deleteLocationAliasAction(aliasId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAliases((prev) => prev.filter((a) => a.id !== aliasId));
    onChanged();
  }

  return (
    <div className="shp-modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="shp-modal"
        style={{ maxWidth: 560, width: "94vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shp-modal__header">
          <div>
            <strong>ניהול כינויים (Alias)</strong>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
              {location.displayName}
              {location.distributionAreaName ? ` · ${location.distributionAreaName}` : ""}
            </div>
          </div>
          <button type="button" className="shp-icon-btn" onClick={onClose} disabled={busy}>
            <X size={16} />
          </button>
        </div>

        <div className="shp-modal__body">
          <p className="loc-admin__hint" style={{ marginBottom: 12 }}>
            הוסיפו שמות חלופיים בכל שפה (עברית, ערבית, אנגלית). המערכת תזהה אותם אוטומטית
            בייבוא — ללא תלות ברווחים, מקפים או אותיות גדולות.
          </p>

          {error && (
            <div className="shp-alert" role="alert" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              placeholder="למשל: BET LAHEM, Bethlehem, بيت لحم…"
              style={{ flex: 1 }}
              disabled={busy}
              onKeyDown={(e) => e.key === "Enter" && void onAdd()}
            />
            <button
              type="button"
              className="shp-btn shp-btn--primary"
              disabled={busy || !newAlias.trim()}
              onClick={() => void onAdd()}
            >
              <Plus size={14} />
              הוסף
            </button>
          </div>

          <div className="shp-daily-wrap" style={{ maxHeight: 320, overflow: "auto" }}>
            <table className="shp-table shp-table--daily">
              <thead>
                <tr>
                  <th>כינוי / Alias</th>
                  <th style={{ width: 100 }}>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={2} className="shp-daily-empty">
                      אין כינויים — הוסיפו שם ראשון
                    </td>
                  </tr>
                )}
                {sorted.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {editingId === a.id ? (
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          autoFocus
                          disabled={busy}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void onSaveEdit(a.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                      ) : (
                        <span dir="auto">{a.originalName}</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {editingId === a.id ? (
                          <button
                            type="button"
                            className="shp-btn shp-btn--sm"
                            disabled={busy}
                            onClick={() => void onSaveEdit(a.id)}
                          >
                            שמור
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="shp-icon-btn"
                              title="עריכה"
                              disabled={busy}
                              onClick={() => {
                                setEditingId(a.id);
                                setEditValue(a.originalName);
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="shp-icon-btn"
                              title="מחיקה"
                              disabled={busy}
                              onClick={() => void onDelete(a.id, a.originalName)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="shp-modal__footer">
          <button type="button" className="shp-btn" onClick={onClose} disabled={busy}>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
