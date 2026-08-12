"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPinned, Plus, Search, X } from "lucide-react";
import type { ShipmentRecordDto, ShipmentZoneDto } from "@/app/admin/shipments/types";
import { distributionAreaNameMatchesQuery, distributionAreaValidationError } from "@/lib/distribution-area-name";
import { getEffectiveDeliveryPlaceFromRecord } from "@/lib/shipment-delivery-place";

type Props = {
  record: ShipmentRecordDto;
  zones: ShipmentZoneDto[];
  busy?: boolean;
  onClose: () => void;
  onCreateZone: (name: string) => Promise<{ id: string; name: string; isActive: boolean } | null>;
  onSave: (zone: { id: string; name: string }) => Promise<boolean>;
};

export function ZoneAssignModal({
  record,
  zones,
  busy = false,
  onClose,
  onCreateZone,
  onSave,
}: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const activeZones = useMemo(
    () =>
      zones
        .filter((z) => z.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "he")),
    [zones],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return activeZones;
    return activeZones.filter((z) => distributionAreaNameMatchesQuery(z.name, q));
  }, [activeZones, query]);

  useEffect(() => {
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const localityHint = getEffectiveDeliveryPlaceFromRecord(record) || "—";

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const validationError = distributionAreaValidationError(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setCreating(true);
    const created = await onCreateZone(name);
    setCreating(false);
    if (!created) {
      setError("יצירת האזור נכשלה");
      return;
    }
    setSelected({ id: created.id, name: created.name });
    setNewName("");
    setQuery(created.name);
  }

  async function handleSave() {
    if (!selected) {
      setError("יש לבחור אזור חלוקה");
      return;
    }
    setError(null);
    setSaving(true);
    const ok = await onSave(selected);
    setSaving(false);
    if (ok) onClose();
    else setError("שמירת האזור נכשלה");
  }

  const locked = busy || saving || creating;

  return (
    <div
      className="shp-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div
        className="shp-modal"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="zone-assign-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440, width: "min(440px, 96vw)" }}
      >
        <header className="shp-modal__head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MapPinned size={18} color="#2563eb" />
          <strong id="zone-assign-title" style={{ flex: 1 }}>
            הגדרת אזור חלוקה
          </strong>
          <button
            type="button"
            className="shp-modal__header-close"
            onClick={onClose}
            disabled={locked}
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </header>

        <div className="shp-modal__body" style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#475569" }}>
            יישוב: <strong>{localityHint}</strong>
            {record.customerName ? (
              <span style={{ color: "#94a3b8" }}> · {record.customerName}</span>
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
            האזור יישמר למשלוח זה וגם ליישוב במערכת — משלוחים עתידיים של אותו יישוב יקבלו אותו אוטומטית.
          </p>

          <div className="shp-form-field" style={{ margin: 0 }}>
            <label htmlFor="zone-assign-search">חיפוש אזור</label>
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94a3b8",
                }}
              />
              <input
                ref={searchRef}
                id="zone-assign-search"
                value={query}
                disabled={locked}
                placeholder="חיפוש — עברית, ערבית, אנגלית"
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingInlineStart: 12, paddingInlineEnd: 32 }}
              />
            </div>
          </div>

          <div
            role="listbox"
            aria-label="אזורי חלוקה"
            style={{
              maxHeight: 220,
              overflow: "auto",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: 14, fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
                לא נמצאו אזורים
              </div>
            ) : (
              filtered.map((z) => {
                const isSelected = selected?.id === z.id;
                return (
                  <button
                    key={z.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={locked}
                    onClick={() => setSelected({ id: z.id, name: z.name })}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "right",
                      padding: "10px 12px",
                      border: "none",
                      borderBottom: "1px solid #f1f5f9",
                      background: isSelected ? "#eff6ff" : "#fff",
                      color: isSelected ? "#1d4ed8" : "#0f172a",
                      fontWeight: isSelected ? 700 : 500,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {z.name}
                  </button>
                );
              })
            )}
          </div>

          <div
            style={{
              border: "1px dashed #cbd5e1",
              borderRadius: 8,
              padding: 10,
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>יצירת אזור חדש</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newName}
                disabled={locked}
                placeholder="שם אזור חופשי"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreate();
                  }
                }}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="shp-btn shp-btn--secondary shp-btn--sm"
                disabled={locked || !newName.trim()}
                onClick={() => void handleCreate()}
              >
                <Plus size={14} />
                {creating ? "יוצר…" : "צור"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="shp-alert shp-alert--error" style={{ margin: 0 }}>
              {error}
            </div>
          ) : null}
        </div>

        <footer className="shp-modal__foot" style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="shp-btn shp-btn--primary"
            disabled={locked || !selected}
            onClick={() => void handleSave()}
          >
            {saving ? "שומר…" : "שמור"}
          </button>
          <button
            type="button"
            className="shp-btn shp-btn--secondary"
            disabled={locked}
            onClick={onClose}
          >
            ביטול
          </button>
        </footer>
      </div>
    </div>
  );
}
