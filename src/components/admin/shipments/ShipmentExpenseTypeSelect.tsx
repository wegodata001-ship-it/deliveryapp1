"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  createShipmentExpenseTypeAction,
  deleteOrDeactivateShipmentExpenseTypeAction,
  listShipmentExpenseTypesAction,
  updateShipmentExpenseTypeAction,
} from "@/app/admin/shipments/expense-types-actions";
import type { ShipmentExpenseTypeDto } from "@/lib/shipment-expense-types";

type Props = {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** קוד נוכחי בהוצאה בעריכה — יוצג גם אם inactive */
  includeCode?: string | null;
};

export function ShipmentExpenseTypeSelect({
  value,
  onChange,
  disabled,
  autoFocus,
  includeCode,
}: Props) {
  const [types, setTypes] = useState<ShipmentExpenseTypeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listShipmentExpenseTypesAction({ includeInactive: true });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTypes(res.types);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectable = types.filter(
    (t) => t.isActive || t.code === includeCode || t.code === value,
  );

  async function handleCreate() {
    setBusy(true);
    setError(null);
    const res = await createShipmentExpenseTypeAction({ label: newLabel });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTypes((prev) => {
      const without = prev.filter((t) => t.id !== res.type.id);
      return [...without, res.type].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "he"),
      );
    });
    onChange(res.type.code);
    setNewLabel("");
    setAdding(false);
  }

  async function handleRename(id: string) {
    setBusy(true);
    setError(null);
    const res = await updateShipmentExpenseTypeAction({ id, label: editLabel });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTypes((prev) => prev.map((t) => (t.id === id ? res.type : t)));
    setEditingId(null);
    setEditLabel("");
  }

  async function handleDelete(type: ShipmentExpenseTypeDto) {
    const msg =
      type.usageCount > 0
        ? `לסוג "${type.label}" יש ${type.usageCount} הוצאות. להפוך ללא פעיל (יישמר בהיסטוריה)?`
        : `למחוק את סוג ההוצאה "${type.label}"?`;
    if (!window.confirm(msg)) return;

    setBusy(true);
    setError(null);
    const res = await deleteOrDeactivateShipmentExpenseTypeAction({ id: type.id });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (res.result === "deleted") {
      setTypes((prev) => prev.filter((t) => t.id !== type.id));
      if (value === type.code) {
        const next = types.find((t) => t.id !== type.id && t.isActive);
        onChange(next?.code ?? "OTHER");
      }
    } else if (res.type) {
      setTypes((prev) => prev.map((t) => (t.id === type.id ? res.type! : t)));
      if (value === type.code && !res.type.isActive) {
        const next = types.find((t) => t.id !== type.id && t.isActive);
        onChange(next?.code ?? "OTHER");
      }
    }
  }

  return (
    <div className="sc-expense-type-select">
      <label className="sc-expense-field">
        <span>סוג הוצאה</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || busy || loading}
          autoFocus={autoFocus}
        >
          {loading && <option value={value}>טוען…</option>}
          {!loading &&
            selectable.map((t) => (
              <option key={t.id} value={t.code}>
                {t.label}
                {!t.isActive ? " (לא פעיל)" : ""}
              </option>
            ))}
        </select>
      </label>

      {!adding ? (
        <div className="sc-expense-type-select__actions">
          <button
            type="button"
            className="shp-btn shp-btn--sm shp-btn--secondary"
            disabled={disabled || busy}
            onClick={() => {
              setAdding(true);
              setNewLabel("");
              setError(null);
            }}
          >
            <Plus size={13} /> הוסף סוג הוצאה חדש
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--sm"
            disabled={disabled || busy || loading}
            onClick={() => setManageOpen((v) => !v)}
          >
            {manageOpen ? "סגור ניהול" : "ניהול סוגים"}
          </button>
        </div>
      ) : (
        <div className="sc-expense-type-select__add">
          <label className="sc-expense-field">
            <span>שם סוג ההוצאה</span>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              disabled={busy}
              autoFocus
              placeholder="לדוגמה: ביטוח"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                }
                if (e.key === "Escape") {
                  setAdding(false);
                  setNewLabel("");
                }
              }}
            />
          </label>
          <div className="sc-expense-type-select__add-btns">
            <button
              type="button"
              className="shp-btn shp-btn--sm"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setNewLabel("");
              }}
            >
              ביטול
            </button>
            <button
              type="button"
              className="shp-btn shp-btn--sm shp-btn--primary"
              disabled={busy || !newLabel.trim()}
              onClick={() => void handleCreate()}
            >
              שמור
            </button>
          </div>
        </div>
      )}

      {manageOpen && (
        <div className="sc-expense-type-select__manage">
          {types.length === 0 && (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>אין סוגי הוצאה</div>
          )}
          {types.map((t) => (
            <div
              key={t.id}
              className={`sc-expense-type-select__row${!t.isActive ? " sc-expense-type-select__row--inactive" : ""}`}
            >
              {editingId === t.id ? (
                <>
                  <input
                    className="sc-expense-type-select__edit-input"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    disabled={busy}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleRename(t.id);
                      }
                      if (e.key === "Escape") {
                        setEditingId(null);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="shp-btn shp-btn--sm shp-btn--primary"
                    disabled={busy || !editLabel.trim()}
                    onClick={() => void handleRename(t.id)}
                  >
                    שמור
                  </button>
                  <button
                    type="button"
                    className="shp-btn shp-btn--icon"
                    disabled={busy}
                    onClick={() => setEditingId(null)}
                    title="ביטול"
                  >
                    <X size={13} />
                  </button>
                </>
              ) : (
                <>
                  <span className="sc-expense-type-select__name">
                    {t.label}
                    {!t.isActive && (
                      <em style={{ color: "#94a3b8", fontStyle: "normal" }}> · לא פעיל</em>
                    )}
                    {t.usageCount > 0 && (
                      <em style={{ color: "#94a3b8", fontStyle: "normal", fontSize: 11 }}>
                        {" "}
                        · {t.usageCount} הוצאות
                      </em>
                    )}
                  </span>
                  <button
                    type="button"
                    className="shp-btn shp-btn--icon"
                    disabled={busy}
                    title="עריכת שם"
                    onClick={() => {
                      setEditingId(t.id);
                      setEditLabel(t.label);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="shp-btn shp-btn--icon"
                    disabled={busy || (!t.isActive && t.usageCount > 0)}
                    title={t.usageCount > 0 ? "הפוך ללא פעיל" : "מחק"}
                    onClick={() => void handleDelete(t)}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <div className="shp-error" style={{ fontSize: 12 }}>{error}</div>}
    </div>
  );
}
